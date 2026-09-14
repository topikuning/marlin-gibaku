import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/r2", async (original) => ({
  ...await original<typeof import("@/lib/r2")>(),
  isR2Configured: () => true,
  r2Put: vi.fn(async () => {}),
}));
let actor: SessionUser;
vi.mock("@/lib/auth/session", async (original) => {
  const real = await original<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  return { ...real, getCurrentUser: async () => actor, requireUser: async () => actor,
    requireCapability: async (cap: Parameters<typeof can>[1]) => {
      if (!can(actor.role, cap)) throw new real.ForbiddenError();
      return actor;
    },
  };
});
const { db } = await import("@/lib/db");
const { transitionArtifactAction, editArtifactAction, distributeArtifactAction, terapkanSaranAction } = await import("@/lib/ai-hub/actions");
const { GET: excel } = await import("@/app/api/ai-artifact/[id]/excel/route");
const { NextRequest } = await import("next/server");
const fd = (data: Record<string, string>) => { const f = new FormData(); for (const [k,v] of Object.entries(data)) f.set(k,v); return f; };
async function org() {
  const tag = randomUUID();
  const o = await db.organization.create({data:{name:tag,slug:tag}});
  const u = await db.user.create({data:{orgId:o.id,username:tag,fullName:tag,passwordHash:"x",role:"super_admin",mustChangePassword:false}});
  const p = await db.package.create({data:{orgId:o.id,name:tag}});
  const l = await db.location.create({data:{packageId:p.id,name:tag,slug:tag,village:"D",regency:"K",province:"P"}});
  return {u,l};
}
let a: Awaited<ReturnType<typeof org>>, b: Awaited<ReturnType<typeof org>>;
beforeAll(async () => { a = await org(); b = await org(); actor = a.u; });
afterAll(async () => { await db.$executeRawUnsafe('TRUNCATE organizations CASCADE'); await db.aiArtifact.deleteMany(); await db.aiRun.deleteMany(); await db.$disconnect(); });
async function artifact(owner = b, status: "draft" | "beku" = "draft") {
  const run = await db.aiRun.create({data:{userId:owner.u.id,orgId:owner.u.orgId,runKind:"laporan",scopeType:"all",scopeIds:[owner.l.id],periodStart:new Date("2026-09-01"),periodEnd:new Date("2026-09-01")}});
  return db.aiArtifact.create({data:{runId:run.id,kind:"laporan",status,title:"Rahasia organisasi",createdById:owner.u.id,structuredContent:{},renderedText:"Rahasia"}});
}

describe("audit: organisasi diperiksa di pintu artefak AI", () => {
  it("ekspor Excel organisasi lain ditolak sebelum kontennya diparsing", async () => {
    const x = await artifact();
    const res = await excel(new NextRequest("https://marlin.test/api/ai-artifact/"+x.id+"/excel"),{params:Promise.resolve({id:x.id})});
    expect(res.status).toBe(404);
  });
  it("transisi artefak organisasi lain tidak mengubah status atau audit", async () => {
    const x = await artifact();
    const res = await transitionArtifactAction(undefined,fd({artifactId:x.id,to:"direview"}));
    expect(res?.error).toBe("Artefak tidak ditemukan.");
    expect((await db.aiArtifact.findUniqueOrThrow({where:{id:x.id}})).status).toBe("draft");
  });
  it("edit organisasi lain ditolak sebelum memproses konten", async () => {
    const x = await artifact();
    const res = await editArtifactAction(undefined,fd({artifactId:x.id,title:"Judul diganti",sectionCount:"1",recommendationCount:"0"}));
    expect(res?.error).toBe("Artefak tidak ditemukan.");
  });
  it("distribusi organisasi lain ditolak sebelum memilih tujuan", async () => {
    const x = await artifact(b,"beku");
    const res = await distributeArtifactAction(undefined,fd({artifactId:x.id}));
    expect(res?.error).toBe("Artefak tidak ditemukan.");
  });
  it("artefak organisasi sendiri tetap bisa direview", async () => {
    const x = await artifact(a);
    const res = await transitionArtifactAction(undefined,fd({artifactId:x.id,to:"direview"}));
    expect(res?.error).toBeUndefined();
    expect((await db.aiArtifact.findUniqueOrThrow({where:{id:x.id}})).status).toBe("direview");
  });
  it("dua pengajuan saran yang bertumpuk hanya membuat satu kendala", async () => {
    const x = await db.aiArtifact.create({data:{kind:"saran",status:"draft",title:"Kendala tunggal",createdById:a.u.id,structuredContent:{locationId:a.l.id,title:"Kendala tunggal",detail:"Perlu tindak lanjut",severity:"sedang",suggestKind:"action"}}});
    // Tahan pembaca pertama SESUDAH status draft terbaca; biarkan kedua commit.
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(r => { release=r; });
    const ready = new Promise<void>(r => { entered=r; });
    const original = db.location.findUnique.bind(db.location);
    const spy = vi.spyOn(db.location,"findUnique").mockImplementationOnce((async (...args: Parameters<typeof original>) => {
      const result = await original(...args); entered(); await held; return result;
    }) as unknown as typeof db.location.findUnique);
    const first = terapkanSaranAction(undefined,fd({artifactId:x.id}));
    await ready;
    let second;
    try { second = await terapkanSaranAction(undefined,fd({artifactId:x.id})); }
    finally { release(); }
    const one = await first;
    spy.mockRestore();
    expect([one,second].filter(r=>r?.ok)).toHaveLength(1);
    expect(await db.issue.count({where:{locationId:a.l.id,title:"Kendala tunggal"}})).toBe(1);
  });
});


it("dokumen paket di luar penugasan tidak dapat diunduh maupun disunting", async () => {
  const pkg = await db.package.create({data:{orgId:a.u.orgId,name:"Paket tidak ditugaskan"}});
  await db.locationAssignment.create({data:{userId:a.u.id,locationId:a.l.id}});
  const doc = await db.document.create({data:{orgId:a.u.orgId,packageId:pkg.id,phase:"kontrak",type:"lainnya",title:"Dokumen terbatas",r2Key:randomUUID(),fileName:"x.pdf",mimeType:"application/pdf",bytes:1,sha256:randomUUID(),uploadedById:a.u.id}});
  actor = {...a.u,role:"project_manager"};
  try {
    const { GET } = await import("@/app/api/documents/[id]/route");
    const response = await GET(new Request("https://marlin.test/api/documents/"+doc.id),{params:Promise.resolve({id:doc.id})});
    expect(response.status).toBe(403);
  } finally { actor = a.u; }
});

it("metadata dokumen paket di luar penugasan tidak bisa diubah lewat ID", async () => {
  const pkg = await db.package.create({data:{orgId:a.u.orgId,name:"Paket lain"}});
  const doc = await db.document.create({data:{orgId:a.u.orgId,packageId:pkg.id,phase:"kontrak",type:"lainnya",title:"Dokumen terbatas",r2Key:randomUUID(),fileName:"x.pdf",mimeType:"application/pdf",bytes:1,sha256:randomUUID(),uploadedById:a.u.id}});
  actor = {...a.u,role:"project_manager"};
  try {
    const {updateDocumentMeta} = await import("@/lib/documents-manage");
    await expect(updateDocumentMeta(doc.id,{title:"Diubah tanpa penugasan"})).rejects.toThrow(/akses|izin/i);
    expect((await db.document.findUniqueOrThrow({where:{id:doc.id}})).title).toBe("Dokumen terbatas");
  } finally { actor = a.u; }
});

it("edit yang sudah membaca draft tidak boleh menimpa artefak yang dibekukan request lain", async () => {
  const {reportOutputSchema} = await import("@/lib/ai-hub/schemas");
  const content = {
    templateKey:"exec_portfolio",templateVersion:1,
    report: reportOutputSchema.parse({title:"Laporan audit",executiveSummary:"Ringkasan yang disetujui dan harus tetap utuh.",overallStatus:"normal",confidence:75,sections:[{heading:"Kondisi",body:"Laporan lengkap",locationId:null}],recommendations:[],waSummary:"Ringkasan WhatsApp lengkap.",limitations:[]}),
    official:{periodStart:"2026-09-01",periodEnd:"2026-09-01",dataAsOf:"2026-09-01T00:00:00Z",rows:[],totals:{locations:0,reportsExpected:0,reportsFinal:0,negativeDeviationLocations:0,openIssues:0,overdueRecoveries:0,lowReadinessLocations:0}},
  };
  const x = await artifact(a);
  await db.aiArtifact.update({where:{id:x.id},data:{status:"disetujui",structuredContent:content}});
  let release!:()=>void, entered!:()=>void;
  const held = new Promise<void>(r=>{release=r;});
  const ready = new Promise<void>(r=>{entered=r;});
  // Kedua bentuk lookup dijaga supaya bukti tetap berlaku saat patch dilepas.
  const original = db.aiArtifact.findFirst.bind(db.aiArtifact);
  const originalUnique = db.aiArtifact.findUnique.bind(db.aiArtifact);
  const spy = vi.spyOn(db.aiArtifact,"findFirst").mockImplementationOnce((async (...args: Parameters<typeof original>) => {
    const result = await original(...args); entered(); await held; return result;
  }) as unknown as typeof db.aiArtifact.findFirst);
  const spyUnique = vi.spyOn(db.aiArtifact,"findUnique").mockImplementationOnce((async (...args: Parameters<typeof originalUnique>) => {
    const result = await originalUnique(...args); entered(); await held; return result;
  }) as unknown as typeof db.aiArtifact.findUnique);
  const editing = editArtifactAction(undefined,fd({artifactId:x.id,title:"Edit terlambat",sectionCount:"1",recommendationCount:"0",executiveSummary:"Ini edit terlambat yang tidak pernah disetujui.",waSummary:"Ringkasan baru belum disetujui.","sectionHeading:0":"Kondisi","sectionBody:0":"Edit terlambat"}));
  await ready;
  let freeze;
  try { freeze = await transitionArtifactAction(undefined,fd({artifactId:x.id,to:"beku"})); }
  finally { release(); }
  const edited = await editing;
  spy.mockRestore();
  spyUnique.mockRestore();
  expect(freeze?.error).toBeUndefined();
  expect(edited?.error).toBeTruthy();
  const result = await db.aiArtifact.findUniqueOrThrow({where:{id:x.id}});
  expect(result.status).toBe("beku");
  expect(result.structuredContent).toEqual(content);
});

it("unggahan tidak boleh menyelesaikan milestone milik paket lain", async () => {
  const {uploadDocument} = await import("@/lib/documents");
  const pkg = await db.package.create({data:{orgId:a.u.orgId,name:"Paket milestone lain"}});
  const ms = await db.adminMilestone.create({data:{packageId:pkg.id,templateKey:"audit",name:"Milestone lain",phase:"kontrak"}});
  await expect(uploadDocument({file:new File([randomUUID()],"audit.pdf",{type:"application/pdf"}),packageId:a.l.packageId,milestoneId:ms.id,title:"Audit",phase:"kontrak",type:"lainnya"},a.u.id)).rejects.toThrow(/paket/i);
  expect((await db.adminMilestone.findUniqueOrThrow({where:{id:ms.id}})).status).toBe("belum_dimulai");
});
it("milestone eksplisit tidak menjadi pintu melewati penugasan paket", async () => {
  const {uploadDocument} = await import("@/lib/documents");
  const pkg = await db.package.create({data:{orgId:a.u.orgId,name:"Paket tanpa akses"}});
  const ms = await db.adminMilestone.create({data:{packageId:pkg.id,templateKey:"audit",name:"Milestone lain",phase:"kontrak"}});
  actor={...a.u,role:"project_manager"};
  try {
    await expect(uploadDocument({file:new File([randomUUID()],"audit.pdf",{type:"application/pdf"}),milestoneId:ms.id,title:"Audit",phase:"kontrak",type:"lainnya"},a.u.id)).rejects.toThrow(/akses|izin/i);
    expect((await db.adminMilestone.findUniqueOrThrow({where:{id:ms.id}})).status).toBe("belum_dimulai");
  } finally {actor=a.u;}
});
it("status terkirim tidak bisa direkayasa tanpa aksi distribusi", async () => {
  const x = await artifact(a,"beku");
  const result = await transitionArtifactAction(undefined,fd({artifactId:x.id,to:"terkirim"}));
  expect(result?.error).toMatch(/distribusi/);
  expect((await db.aiArtifact.findUniqueOrThrow({where:{id:x.id}})).status).toBe("beku");
});

for (const relation of ["contractId","amendmentId"] as const) {
  for (const explicitPackage of [true,false]) {
    it(`unggahan ${relation} menjaga paket ${explicitPackage ? "eksplisit" : "turunan"}`, async () => {
      const {uploadDocument} = await import("@/lib/documents");
      const pkg = await db.package.create({data:{orgId:a.u.orgId,name:"Paket kontrak lain"}});
      const vendor = await db.vendor.create({data:{orgId:a.u.orgId,name:randomUUID()}});
      const contract = await db.contract.create({data:{packageId:pkg.id,vendorId:vendor.id,contractNumber:randomUUID(),contractValue:100n,signedDate:new Date()}});
      const amendment = await db.contractAmendment.create({data:{contractId:contract.id,ccoNumber:randomUUID(),valueDelta:0n,endDateDelta:0,effectiveDate:new Date(),reason:"Audit"}});
      actor={...a.u,role:"project_manager"};
      try {
        await expect(uploadDocument({file:new File([randomUUID()],"audit.pdf",{type:"application/pdf"}),packageId:explicitPackage?a.l.packageId:undefined,[relation]:relation === "contractId"?contract.id:amendment.id,title:"Audit",phase:"kontrak",type:"lainnya"},a.u.id)).rejects.toThrow(/paket|akses|izin/i);
      } finally { actor=a.u; }
    });
  }
}

it("suntingan paparan yang tertunda tidak boleh mengubah snapshot beku", async () => {
  const {suntingNarasiPaparanAction,transisiPaparanAction} = await import("@/lib/paparan/actions");
  const content = {templateKey:"paparan_mingguan_kkp",snapshot:{version:1,fotoKandidat:[]},narasi:{},selectedPhotoIds:[]};
  const x = await db.aiArtifact.create({data:{kind:"paparan",status:"disetujui",title:"Paparan audit",createdById:a.u.id,packageId:a.l.packageId,structuredContent:content}});
  let release!:()=>void, entered!:()=>void;
  const held=new Promise<void>(r=>{release=r;});
  const ready=new Promise<void>(r=>{entered=r;});
  const original=db.aiArtifact.findUnique.bind(db.aiArtifact);
  const spy=vi.spyOn(db.aiArtifact,"findUnique").mockImplementationOnce((async (...args: Parameters<typeof original>)=>{
    const result=await original(...args);entered();await held;return result;
  }) as unknown as typeof db.aiArtifact.findUnique);
  const editing=suntingNarasiPaparanAction(undefined,fd({artifactId:x.id,title:"Suntingan terlambat",ringkasanEksekutif:"Narasi baru"}));
  await ready;
  let freeze;
  try {freeze=await transisiPaparanAction(undefined,fd({artifactId:x.id,to:"beku"}));}
  finally {release();}
  const result=await editing;
  spy.mockRestore();
  expect(freeze?.error).toBeUndefined();
  expect(result?.error).toBeTruthy();
  expect((await db.aiArtifact.findUniqueOrThrow({where:{id:x.id}})).structuredContent).toEqual(content);
});
it("unggahan melalui kontrak sendiri tetap berhasil dan menurunkan paket", async () => {
  const {uploadDocument}=await import("@/lib/documents");
  const vendor=await db.vendor.create({data:{orgId:a.u.orgId,name:randomUUID()}});
  const contract=await db.contract.create({data:{packageId:a.l.packageId,vendorId:vendor.id,contractNumber:randomUUID(),contractValue:100n,signedDate:new Date()}});
  actor={...a.u,role:"project_manager"};
  try {
    const doc=await uploadDocument({file:new File([randomUUID()],"audit.pdf",{type:"application/pdf"}),contractId:contract.id,title:"Audit sah",phase:"kontrak",type:"lainnya"},a.u.id);
    expect((await db.document.findUniqueOrThrow({where:{id:doc.id}})).packageId).toBe(a.l.packageId);
  } finally {actor=a.u;}
});
