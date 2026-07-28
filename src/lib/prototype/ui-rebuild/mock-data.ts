export const PROTOTYPE_DATA_AS_OF = "28 Juli 2026 · 07.30 WIB";
export const PROTOTYPE_DATE_KEY = "2026-07-28";

export type PrototypeReportStatus =
  | "belum_ada"
  | "draft"
  | "dikirim"
  | "disetujui"
  | "final";

export type PrototypeHealth = "kritis" | "waspada" | "terkendali" | "selesai";
export type PrototypeSeverity = "kritis" | "tinggi" | "sedang" | "rendah";

export type PrototypeLocation = {
  id: string;
  slug: string;
  name: string;
  province: string;
  regency: string;
  company: string;
  project: string;
  owner: string | null;
  status: "persiapan" | "berjalan" | "terhenti" | "selesai";
  health: PrototypeHealth;
  planPct: number;
  reportedPct: number;
  verifiedPct: number;
  finalPct: number;
  deviationPct: number;
  reportStatus: PrototypeReportStatus;
  reportTime: string | null;
  delayHours: number;
  issueCount: number;
  criticalIssue: string | null;
  suggestedSolution: string | null;
  latestWork: string;
  lastActivity: string;
  hasPhoto: boolean;
  photoLabel: string | null;
};

export type PrototypeException = {
  id: string;
  severity: PrototypeSeverity;
  category:
    | "Keselamatan"
    | "Jadwal"
    | "Blocker"
    | "Laporan"
    | "Approval"
    | "Biaya"
    | "Dokumen";
  title: string;
  detail: string;
  locationId: string;
  locationName: string;
  project: string;
  owner: string | null;
  age: string;
  due: string;
  proposedSolution: string | null;
  nextAction: string;
  hasEvidence: boolean;
};

export type PrototypeActivity = {
  id: string;
  kind: "laporan" | "kendala" | "solusi" | "approval" | "progress" | "dokumen";
  title: string;
  context: string;
  time: string;
  important: boolean;
};

const PROVINCES = [
  ["Jawa Barat", "Kabupaten Cirebon"],
  ["Jawa Tengah", "Kabupaten Demak"],
  ["Jawa Timur", "Kabupaten Lamongan"],
  ["Sumatera Utara", "Kabupaten Serdang Bedagai"],
  ["Lampung", "Kabupaten Pesawaran"],
  ["Sulawesi Selatan", "Kabupaten Takalar"],
  ["Nusa Tenggara Timur", "Kabupaten Kupang"],
] as const;

const COMPANIES = [
  "PT Maritim Karya Nusantara",
  "PT Pesisir Bangun Indonesia",
  "PT Samudra Infrastruktur",
  "KSO Bahari–Cipta",
] as const;

const PROJECTS = [
  "KNMP Paket Barat I",
  "KNMP Paket Barat II",
  "KNMP Pantura",
  "KNMP Jawa Timur",
  "KNMP Sumatera",
  "KNMP Sulawesi",
  "KNMP Nusa Tenggara",
  "Program Sarana Pendukung",
] as const;

const OWNERS = [
  "Rizky Maulana",
  "Siti Rahma",
  "Agus Santoso",
  "Fajar Nugroho",
  "Dewi Lestari",
  "M. Ridwan",
  "Nur Aisyah",
  "Bambang Irawan",
] as const;

const WORKS = [
  "Pengecoran lantai kerja TPI",
  "Pemasangan batu revetment",
  "Fabrikasi rangka atap",
  "Pemadatan lapis pondasi",
  "Pemasangan jaringan air bersih",
  "Pekerjaan drainase kawasan",
  "Finishing kios nelayan",
  "Instalasi panel dan penerangan",
] as const;

const ISSUE_TITLES = [
  "Akses material tertutup pasang laut",
  "Pengiriman beton tertunda",
  "Persetujuan shop drawing belum terbit",
  "Alat pancang mengalami kerusakan",
  "Stok batu armor di bawah kebutuhan",
  "Area kerja belum bebas utilitas",
  "Hujan lebat menghentikan pekerjaan",
  "Dokumen uji material belum lengkap",
] as const;

const SOLUTIONS = [
  "Alihkan pengiriman ke jendela pasang berikutnya dan tambah satu shift bongkar.",
  "Gunakan pemasok cadangan yang sudah lolos evaluasi mutu.",
  "Eskalasi review ke konsultan dan batasi pekerjaan pada area yang sudah disetujui.",
  "Mobilisasi unit pengganti dari lokasi terdekat.",
  "Prioritaskan volume kritis dan jadwalkan pengiriman bertahap.",
  "Lakukan joint survey dengan pemilik utilitas pagi ini.",
  "Pindahkan tenaga ke pekerjaan fabrikasi tertutup.",
  "Minta laboratorium mengirim hasil digital sebelum dokumen asli.",
] as const;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generatePrototypeLocations(count = 120): PrototypeLocation[] {
  const random = mulberry32(20260728);
  const locations: PrototypeLocation[] = [];

  for (let index = 0; index < count; index += 1) {
    const provinceIndex = index % PROVINCES.length;
    const [province, regency] = PROVINCES[provinceIndex];
    const village = `Desa Bahari ${String(index + 1).padStart(3, "0")}`;
    const longName =
      index === 7
        ? "Kawasan Sentra Produksi Perikanan Terpadu Pesisir Utara dengan Dermaga dan Fasilitas Rantai Dingin"
        : index === 43
          ? "Kampung Nelayan Teluk Harapan Baru — Zona Infrastruktur Pendukung"
          : `Kampung Nelayan ${village.replace("Desa ", "")}`;

    const planPct = oneDecimal(clamp(8 + random() * 88));
    const rawDeviation = oneDecimal(-24 + random() * 34);
    let reportedPct = oneDecimal(clamp(planPct + rawDeviation));
    let reportStatus: PrototypeReportStatus =
      index % 11 === 0
        ? "belum_ada"
        : index % 7 === 0
          ? "draft"
          : index % 5 === 0
            ? "dikirim"
            : index % 3 === 0
              ? "disetujui"
              : "final";

    if (index === 0) {
      reportedPct = 0;
      reportStatus = "belum_ada";
    }
    if (index === 1) {
      reportedPct = 100;
      reportStatus = "final";
    }
    if (index === 2) {
      reportedPct = oneDecimal(clamp(planPct - 31.4));
      reportStatus = "dikirim";
    }

    const verifiedGap = reportStatus === "dikirim" ? 3.8 + random() * 4 : random() * 1.8;
    const finalGap = reportStatus === "final" ? random() * 0.5 : 1.2 + random() * 3.4;
    const verifiedPct = oneDecimal(clamp(reportedPct - verifiedGap));
    const finalPct = oneDecimal(clamp(verifiedPct - finalGap));
    const deviationPct = oneDecimal(reportedPct - planPct);
    const issueCount = index === 4 ? 9 : Math.floor(random() * 5);
    const hasCriticalIssue = index % 17 === 0 || (issueCount >= 3 && deviationPct < -10);
    const status =
      reportedPct >= 100
        ? "selesai"
        : index % 29 === 0
          ? "terhenti"
          : index % 19 === 0
            ? "persiapan"
            : "berjalan";
    const health: PrototypeHealth =
      status === "selesai"
        ? "selesai"
        : status === "terhenti" || hasCriticalIssue || deviationPct <= -15
          ? "kritis"
          : reportStatus === "belum_ada" || reportStatus === "draft" || deviationPct < -5
            ? "waspada"
            : "terkendali";
    const hasOwner = index % 31 !== 0;
    const hasPhoto = index % 8 !== 0;
    const reportHour = 6 + Math.floor(random() * 12);
    const reportMinute = Math.floor(random() * 6) * 10;

    locations.push({
      id: `loc-${String(index + 1).padStart(3, "0")}`,
      slug: slugify(`${longName}-${index + 1}`),
      name: longName,
      province,
      regency,
      company: COMPANIES[index % COMPANIES.length],
      project: PROJECTS[index % PROJECTS.length],
      owner: hasOwner ? OWNERS[index % OWNERS.length] : null,
      status,
      health,
      planPct,
      reportedPct,
      verifiedPct,
      finalPct,
      deviationPct,
      reportStatus,
      reportTime:
        reportStatus === "belum_ada"
          ? null
          : `${String(reportHour).padStart(2, "0")}.${String(reportMinute).padStart(2, "0")} WIB`,
      delayHours:
        reportStatus === "belum_ada" ? 8 + (index % 13) : reportStatus === "draft" ? 3 + (index % 6) : 0,
      issueCount,
      criticalIssue: hasCriticalIssue ? ISSUE_TITLES[index % ISSUE_TITLES.length] : null,
      suggestedSolution:
        hasCriticalIssue && index % 6 !== 0 ? SOLUTIONS[index % SOLUTIONS.length] : null,
      latestWork: WORKS[index % WORKS.length],
      lastActivity:
        reportStatus === "belum_ada"
          ? `${1 + (index % 3)} hari lalu`
          : `${8 + (index % 47)} menit lalu`,
      hasPhoto,
      photoLabel: hasPhoto ? `Bukti ${WORKS[index % WORKS.length].toLowerCase()}` : null,
    });
  }

  return locations;
}

export const PROTOTYPE_LOCATIONS = generatePrototypeLocations();

const SEVERITY_ORDER: Record<PrototypeSeverity, number> = {
  kritis: 0,
  tinggi: 1,
  sedang: 2,
  rendah: 3,
};

const CATEGORY_ORDER: Record<PrototypeException["category"], number> = {
  Keselamatan: 0,
  Jadwal: 1,
  Blocker: 2,
  Laporan: 3,
  Approval: 4,
  Biaya: 5,
  Dokumen: 6,
};

export function buildPrototypeExceptions(
  locations: PrototypeLocation[] = PROTOTYPE_LOCATIONS,
): PrototypeException[] {
  const items: PrototypeException[] = [];

  for (const [index, location] of locations.entries()) {
    if (location.criticalIssue) {
      const category =
        index % 13 === 0
          ? "Keselamatan"
          : index % 5 === 0
            ? "Blocker"
            : "Jadwal";
      items.push({
        id: `exception-issue-${location.id}`,
        severity: location.health === "kritis" ? "kritis" : "tinggi",
        category,
        title: location.criticalIssue,
        detail: `${location.latestWork}. Progress Dilaporkan ${location.reportedPct.toFixed(1)}%, tertinggal ${Math.abs(location.deviationPct).toFixed(1)} poin dari rencana.`,
        locationId: location.id,
        locationName: location.name,
        project: location.project,
        owner: location.owner,
        age: `${2 + (index % 19)} jam`,
        due: index % 4 === 0 ? "Lewat 2 jam" : "Hari ini · 14.00",
        proposedSolution: location.suggestedSolution,
        nextAction:
          category === "Keselamatan"
            ? "Konfirmasi penghentian area dan keputusan mitigasi"
            : "Tinjau solusi tim dan tetapkan penanggung jawab",
        hasEvidence: location.hasPhoto,
      });
    }

    if (location.reportStatus === "belum_ada" || location.reportStatus === "draft") {
      items.push({
        id: `exception-report-${location.id}`,
        severity: location.delayHours >= 12 ? "tinggi" : "sedang",
        category: "Laporan",
        title:
          location.reportStatus === "belum_ada"
            ? "Laporan hari ini belum masuk"
            : "Draft laporan belum dikirim",
        detail: `Batas submit 18.00 WIB. Aktivitas terakhir ${location.lastActivity}.`,
        locationId: location.id,
        locationName: location.name,
        project: location.project,
        owner: location.owner,
        age: `${location.delayHours} jam`,
        due: location.delayHours >= 12 ? "Lewat batas" : "Hari ini · 18.00",
        proposedSolution: null,
        nextAction: "Hubungi PIC dan minta konfirmasi status pekerjaan",
        hasEvidence: false,
      });
    }

    if (location.reportStatus === "dikirim" && index % 4 === 0) {
      items.push({
        id: `exception-approval-${location.id}`,
        severity: index % 8 === 0 ? "tinggi" : "sedang",
        category: "Approval",
        title: "Laporan menunggu verifikasi",
        detail: `Dikirim ${location.reportTime}; volume dan bukti foto siap ditinjau.`,
        locationId: location.id,
        locationName: location.name,
        project: location.project,
        owner: location.owner,
        age: `${1 + (index % 9)} jam`,
        due: "Hari ini · 20.00",
        proposedSolution: "Verifikasi item kritis terlebih dahulu.",
        nextAction: "Buka ringkasan laporan dan putuskan",
        hasEvidence: location.hasPhoto,
      });
    }
  }

  return items
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
        a.locationName.localeCompare(b.locationName),
    )
    .slice(0, 48);
}

export const PROTOTYPE_EXCEPTIONS = buildPrototypeExceptions();

export const PROTOTYPE_ACTIVITIES: PrototypeActivity[] = [
  {
    id: "activity-1",
    kind: "kendala",
    title: "Kendala keselamatan baru membutuhkan keputusan",
    context: `${PROTOTYPE_LOCATIONS[13].name} · ${PROTOTYPE_LOCATIONS[13].project}`,
    time: "8 menit lalu",
    important: true,
  },
  {
    id: "activity-2",
    kind: "laporan",
    title: "12 laporan lapangan masuk dalam 30 menit terakhir",
    context: "Jawa Barat, Jawa Tengah, dan Lampung",
    time: "14 menit lalu",
    important: false,
  },
  {
    id: "activity-3",
    kind: "solusi",
    title: "Solusi pemulihan jadwal diperbarui Site Manager",
    context: PROTOTYPE_LOCATIONS[2].name,
    time: "21 menit lalu",
    important: true,
  },
  {
    id: "activity-4",
    kind: "approval",
    title: "Laporan harian disetujui dan menunggu finalisasi",
    context: PROTOTYPE_LOCATIONS[9].name,
    time: "34 menit lalu",
    important: false,
  },
  {
    id: "activity-5",
    kind: "progress",
    title: "Deviasi membaik 2,4 poin setelah update volume",
    context: PROTOTYPE_LOCATIONS[18].name,
    time: "47 menit lalu",
    important: false,
  },
  {
    id: "activity-6",
    kind: "dokumen",
    title: "Hasil uji material baru tersedia",
    context: PROTOTYPE_LOCATIONS[26].name,
    time: "1 jam lalu",
    important: false,
  },
];

export type PrototypePortfolioSummary = {
  active: number;
  submitted: number;
  missing: number;
  negativeDeviation: number;
  criticalIssues: number;
  awaitingDecision: number;
  draft: number;
  sent: number;
  approved: number;
  final: number;
};

export function summarizePrototypePortfolio(
  locations: PrototypeLocation[],
  exceptions: PrototypeException[] = buildPrototypeExceptions(locations),
): PrototypePortfolioSummary {
  return {
    active: locations.filter((location) => location.status !== "selesai").length,
    submitted: locations.filter(
      (location) => !["belum_ada", "draft"].includes(location.reportStatus),
    ).length,
    missing: locations.filter((location) => location.reportStatus === "belum_ada").length,
    negativeDeviation: locations.filter((location) => location.deviationPct < -5).length,
    criticalIssues: locations.filter((location) => location.health === "kritis").length,
    awaitingDecision: exceptions.filter(
      (item) =>
        item.severity === "kritis" ||
        item.category === "Approval" ||
        !item.proposedSolution,
    ).length,
    draft: locations.filter((location) => location.reportStatus === "draft").length,
    sent: locations.filter((location) => location.reportStatus === "dikirim").length,
    approved: locations.filter((location) => location.reportStatus === "disetujui").length,
    final: locations.filter((location) => location.reportStatus === "final").length,
  };
}

export const PROTOTYPE_SUMMARY = summarizePrototypePortfolio(
  PROTOTYPE_LOCATIONS,
  PROTOTYPE_EXCEPTIONS,
);

export function provinceDistribution(locations: PrototypeLocation[]) {
  return PROVINCES.map(([province]) => {
    const rows = locations.filter((location) => location.province === province);
    return {
      province,
      total: rows.length,
      critical: rows.filter((location) => location.health === "kritis").length,
      missing: rows.filter((location) => location.reportStatus === "belum_ada").length,
      averageDeviation:
        rows.length === 0
          ? 0
          : oneDecimal(
              rows.reduce((sum, location) => sum + location.deviationPct, 0) /
                rows.length,
            ),
    };
  });
}
