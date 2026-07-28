"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Building2,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  CloudOff,
  FileCheck2,
  FileText,
  Filter,
  FolderOpen,
  HardHat,
  HelpCircle,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  PackageCheck,
  PanelLeftClose,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserRound,
  Users,
  WalletCards,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PROTOTYPE_ACTIVITIES,
  PROTOTYPE_DATA_AS_OF,
  PROTOTYPE_EXCEPTIONS,
  PROTOTYPE_LOCATIONS,
  PROTOTYPE_SUMMARY,
  provinceDistribution,
  type PrototypeException,
  type PrototypeHealth,
  type PrototypeLocation,
  type PrototypeReportStatus,
  type PrototypeSeverity,
} from "@/lib/prototype/ui-rebuild/mock-data";
import styles from "./prototype.module.css";

export type PrototypeView =
  | "command"
  | "actions"
  | "locations"
  | "location"
  | "report"
  | "progress"
  | "ai";

type DemoState = "ready" | "loading" | "empty" | "error";

type NavItem = {
  view: PrototypeView;
  label: string;
  icon: LucideIcon;
  count?: number;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Ringkasan",
    items: [
      { view: "command", label: "Command centre", icon: BarChart3 },
      {
        view: "actions",
        label: "Perlu tindakan",
        icon: ClipboardCheck,
        count: PROTOTYPE_SUMMARY.awaitingDecision,
      },
    ],
  },
  {
    label: "Pelaksanaan",
    items: [
      { view: "locations", label: "Lokasi", icon: MapPin },
      { view: "report", label: "Laporan lapangan", icon: FileText },
      { view: "progress", label: "Progress", icon: TrendingUp },
      { view: "actions", label: "Kendala", icon: AlertTriangle },
      { view: "location", label: "Foto", icon: Camera },
    ],
  },
  {
    label: "Komersial",
    items: [
      { view: "location", label: "RAB & BOQ", icon: PackageCheck },
      { view: "location", label: "Keuangan", icon: WalletCards },
      { view: "actions", label: "Termin & tagihan", icon: CircleDollarSign },
      { view: "location", label: "Dokumen", icon: FolderOpen },
    ],
  },
  {
    label: "Analisis",
    items: [
      { view: "progress", label: "Laporan", icon: FileCheck2 },
      { view: "ai", label: "AI Hub", icon: Sparkles },
    ],
  },
  {
    label: "Administrasi",
    items: [
      { view: "location", label: "Kontrak", icon: Building2 },
      { view: "locations", label: "Personel", icon: Users },
      { view: "command", label: "Pengaturan", icon: Settings },
    ],
  },
];

const PRIMARY_NAV_LABEL: Record<PrototypeView, string> = {
  command: "Command centre",
  actions: "Perlu tindakan",
  locations: "Lokasi",
  location: "Lokasi",
  report: "Laporan lapangan",
  progress: "Progress",
  ai: "AI Hub",
};

const VIEW_LABEL: Record<PrototypeView, string> = {
  command: "Command centre",
  actions: "Perlu tindakan",
  locations: "Monitor lokasi",
  location: "Workspace lokasi",
  report: "Laporan lapangan",
  progress: "Progress & deviasi",
  ai: "AI Hub · Portfolio Pulse",
};

const REPORT_LABEL: Record<PrototypeReportStatus, string> = {
  belum_ada: "Belum ada",
  draft: "Draft",
  dikirim: "Dikirim",
  disetujui: "Disetujui",
  final: "Final",
};

const HEALTH_LABEL: Record<PrototypeHealth, string> = {
  kritis: "Kritis",
  waspada: "Perlu perhatian",
  terkendali: "Terkendali",
  selesai: "Selesai",
};

const SEVERITY_LABEL: Record<PrototypeSeverity, string> = {
  kritis: "Kritis",
  tinggi: "Tinggi",
  sedang: "Sedang",
  rendah: "Rendah",
};

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function formatPct(value: number): string {
  return `${value.toLocaleString("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function toneForHealth(health: PrototypeHealth): string {
  return styles[`tone_${health}`];
}

function toneForReport(status: PrototypeReportStatus): string {
  return styles[`report_${status}`];
}

function StatusBadge({
  label,
  tone,
  icon: Icon,
}: {
  label: string;
  tone: string;
  icon?: LucideIcon;
}) {
  return (
    <span className={cx(styles.badge, tone)}>
      {Icon ? <Icon aria-hidden="true" size={13} /> : <span aria-hidden className={styles.badgeDot} />}
      {label}
    </span>
  );
}

function IconButton({
  label,
  children,
  onClick,
  className,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(styles.iconButton, className)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  onClick,
  type = "button",
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      className={cx(styles.button, styles.buttonPrimary, className)}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  type = "button",
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      className={cx(styles.button, styles.buttonSecondary, className)}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.sectionHeading}>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className={styles.sectionAction}>{action}</div> : null}
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageIntro}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.pageDescription}>{description}</p>
      </div>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </header>
  );
}

function ProgressTrack({
  value,
  plan,
  compact = false,
}: {
  value: number;
  plan?: number;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(styles.progressTrack, compact && styles.progressTrackCompact)}
      role="img"
      aria-label={
        plan == null
          ? `Progress ${formatPct(value)}`
          : `Progress Dilaporkan ${formatPct(value)}, rencana ${formatPct(plan)}`
      }
    >
      <span className={styles.progressFill} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      {plan == null ? null : (
        <span
          className={styles.planMarker}
          style={{ left: `${Math.max(0, Math.min(100, plan))}%` }}
          title={`Rencana ${formatPct(plan)}`}
        />
      )}
    </div>
  );
}

function StatePanel({
  state,
  onRetry,
}: {
  state: Exclude<DemoState, "ready">;
  onRetry: () => void;
}) {
  if (state === "loading") {
    return (
      <div className={styles.statePanel} role="status" aria-live="polite">
        <Loader2 aria-hidden className={styles.spin} size={28} />
        <h2>Menyusun status 120 lokasi</h2>
        <p>Menyiapkan submission, deviasi, kendala, dan tindakan prioritas.</p>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className={styles.statePanel} role="alert">
        <CloudOff aria-hidden size={30} />
        <h2>Data command centre tidak dapat dimuat</h2>
        <p>Snapshot terakhir tetap aman. Coba muat ulang data prototype.</p>
        <SecondaryButton onClick={onRetry}>
          <RefreshCw aria-hidden size={16} /> Coba lagi
        </SecondaryButton>
      </div>
    );
  }
  return (
    <div className={styles.statePanel}>
      <Search aria-hidden size={30} />
      <h2>Tidak ada lokasi yang cocok</h2>
      <p>Filter aktif tidak menghasilkan data. Bersihkan filter untuk kembali ke portfolio.</p>
      <SecondaryButton onClick={onRetry}>
        <RotateCcw aria-hidden size={16} /> Bersihkan filter
      </SecondaryButton>
    </div>
  );
}

function ContextDrawer({
  item,
  onClose,
  onOpenLocation,
  closeRef,
}: {
  item: PrototypeException;
  onClose: () => void;
  onOpenLocation: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className={styles.drawerLayer}>
      <button
        type="button"
        className={styles.drawerBackdrop}
        aria-label="Tutup detail tindakan"
        onClick={onClose}
      />
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        aria-describedby="drawer-description"
      >
        <header className={styles.drawerHeader}>
          <div>
            <p className={styles.eyebrow}>{item.category}</p>
            <h2 id="drawer-title">{item.title}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Tutup detail"
            onClick={onClose}
            className={`${styles.iconButton} ${styles.drawerClose}`}
          >
            <X aria-hidden size={20} />
          </button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.drawerStatusRow}>
            <StatusBadge
              label={SEVERITY_LABEL[item.severity]}
              tone={styles[`severity_${item.severity}`]}
              icon={item.severity === "kritis" ? ShieldAlert : CircleAlert}
            />
            <span className={styles.metaText}>{item.age} · {item.due}</span>
          </div>

          <section className={styles.contextBlock}>
            <p className={styles.contextLabel}>Konteks</p>
            <h3>{item.locationName}</h3>
            <p>{item.project}</p>
          </section>

          <section>
            <h3>Yang terjadi</h3>
            <p id="drawer-description" className={styles.bodyCopy}>{item.detail}</p>
          </section>

          <dl className={styles.factList}>
            <div>
              <dt>Penanggung jawab</dt>
              <dd>{item.owner ?? "Belum ditetapkan"}</dd>
            </div>
            <div>
              <dt>Bukti lapangan</dt>
              <dd>{item.hasEvidence ? "Tersedia · 3 foto" : "Belum tersedia"}</dd>
            </div>
            <div>
              <dt>Batas tindakan</dt>
              <dd>{item.due}</dd>
            </div>
          </dl>

          <section className={styles.recommendation}>
            <div className={styles.recommendationIcon}>
              <Wrench aria-hidden size={18} />
            </div>
            <div>
              <p className={styles.contextLabel}>Solusi yang diajukan tim</p>
              <p>{item.proposedSolution ?? "Tim belum mengajukan solusi. Minta PIC melengkapi sebelum keputusan."}</p>
            </div>
          </section>

          {item.hasEvidence ? (
            <div className={styles.evidencePreview} role="img" aria-label="Placeholder bukti foto lapangan">
              <ImageIcon aria-hidden size={28} />
              <span>3 bukti foto · mock</span>
            </div>
          ) : null}
        </div>
        <footer className={styles.drawerFooter}>
          <SecondaryButton onClick={onClose}>Nanti</SecondaryButton>
          <PrimaryButton onClick={onOpenLocation}>
            {item.nextAction} <ArrowRight aria-hidden size={16} />
          </PrimaryButton>
        </footer>
      </aside>
    </div>
  );
}

function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  cancelRef,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className={styles.dialogLayer}>
      <button
        type="button"
        className={styles.dialogBackdrop}
        aria-label="Tutup konfirmasi"
        onClick={onClose}
      />
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
      >
        <div className={styles.dialogIcon}>
          <Send aria-hidden size={22} />
        </div>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-description">{description}</p>
        <div className={styles.dialogActions}>
          <button
            ref={cancelRef}
            type="button"
            className={cx(styles.button, styles.buttonSecondary)}
            onClick={onClose}
          >
            Kembali periksa
          </button>
          <PrimaryButton onClick={onConfirm}>{confirmLabel}</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

export function PrototypeApp({ initialView = "command" }: { initialView?: PrototypeView }) {
  const [view, setView] = useState<PrototypeView>(initialView);
  const [selectedLocation, setSelectedLocation] = useState<PrototypeLocation>(
    PROTOTYPE_LOCATIONS[2],
  );
  const [drawerItem, setDrawerItem] = useState<PrototypeException | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [railCompact, setRailCompact] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [scope, setScope] = useState("Semua proyek");
  const [toast, setToast] = useState<string | null>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const mobileMenuTriggerRef = useRef<HTMLElement | null>(null);
  const mobileMenuCloseRef = useRef<HTMLButtonElement>(null);
  const globalSearchRef = useRef<HTMLInputElement>(null);

  const navigate = (next: PrototypeView) => {
    setView(next);
    setMobileMenuOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.pushState({ view: next }, "", url);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("#prototype-main h1")?.focus());
  };

  const openLocation = (location: PrototypeLocation, next: PrototypeView = "location") => {
    setSelectedLocation(location);
    navigate(next);
  };

  useEffect(() => {
    const onPopState = () => {
      const next = new URLSearchParams(window.location.search).get("view") as PrototypeView | null;
      setView(next && next in VIEW_LABEL ? next : "command");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!drawerItem) return;
    drawerCloseRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDrawerItem(null);
      requestAnimationFrame(() => drawerTriggerRef.current?.focus());
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [drawerItem]);

  const openDrawer = (item: PrototypeException, trigger: HTMLElement) => {
    drawerTriggerRef.current = trigger;
    setDrawerItem(item);
  };

  const closeDrawer = () => {
    setDrawerItem(null);
    requestAnimationFrame(() => drawerTriggerRef.current?.focus());
  };

  const openMobileMenu = () => {
    mobileMenuTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setMobileMenuOpen(true);
  };

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    requestAnimationFrame(() => mobileMenuTriggerRef.current?.focus());
  };

  useEffect(() => {
    if (!mobileMenuOpen) return;
    mobileMenuCloseRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileMenu();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [mobileMenuOpen]);

  const searchMatches = useMemo(() => {
    const query = globalSearch.trim().toLowerCase();
    if (query.length < 2) return [];
    return PROTOTYPE_LOCATIONS.filter((location) =>
      [location.name, location.regency, location.province, location.project, location.owner ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    ).slice(0, 6);
  }, [globalSearch]);

  return (
    <div className={styles.prototype}>
      <a className={styles.skipLink} href="#prototype-main">Lewati ke konten utama</a>
      <div className={styles.prototypeBanner}>
        <span><Wrench aria-hidden size={14} /> Prototype UI · data mock · bukan produksi</span>
        <span>{PROTOTYPE_DATA_AS_OF}</span>
      </div>

      <aside className={cx(styles.rail, railCompact && styles.railCompact)}>
        <div className={styles.brandBlock}>
          <span className={styles.brandMark}>M</span>
          <div className={styles.brandWords}>
            <strong>MARLIN</strong>
            <span>Project command centre</span>
          </div>
        </div>

        <nav className={styles.desktopNav} aria-label="Navigasi prototype">
          {NAV_GROUPS.map((group) => (
            <div className={styles.navGroup} key={group.label}>
              <p className={styles.navGroupLabel}>{group.label}</p>
              {group.items.map((item, index) => {
                const Icon = item.icon;
                const active = item.label === PRIMARY_NAV_LABEL[view];
                return (
                  <button
                    type="button"
                    className={cx(styles.navItem, active && styles.navItemActive)}
                    aria-current={active ? "page" : undefined}
                    onClick={() => navigate(item.view)}
                    key={`${group.label}-${item.label}-${index}`}
                  >
                    <Icon aria-hidden size={18} />
                    <span>{item.label}</span>
                    {item.count ? <em>{item.count}</em> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <button
          type="button"
          className={styles.compactToggle}
          onClick={() => setRailCompact((current) => !current)}
          aria-label={railCompact ? "Perlebar navigasi" : "Padatkan navigasi"}
        >
          <PanelLeftClose aria-hidden size={17} />
          <span>{railCompact ? "Perlebar" : "Padatkan"}</span>
        </button>
      </aside>

      <div className={cx(styles.appBody, railCompact && styles.appBodyCompact)}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.mobileMenuButton}
            onClick={openMobileMenu}
            aria-label="Buka menu"
            aria-expanded={mobileMenuOpen}
          >
            <Menu aria-hidden size={21} />
          </button>
          <div className={styles.topbarContext}>
            <span>Portfolio nasional</span>
            <ChevronRight aria-hidden size={14} />
            <strong>{VIEW_LABEL[view]}</strong>
          </div>

          <div className={styles.globalSearch}>
            <Search aria-hidden size={17} />
            <input
              ref={globalSearchRef}
              type="search"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Cari lokasi, proyek, PIC…"
              aria-label="Cari lokasi, proyek, atau PIC"
            />
            <kbd>/</kbd>
            {searchMatches.length > 0 ? (
              <div className={styles.searchResults}>
                <p>Hasil lokasi</p>
                {searchMatches.map((location) => (
                  <button
                    type="button"
                    key={location.id}
                    onClick={() => {
                      setGlobalSearch("");
                      openLocation(location);
                    }}
                  >
                    <MapPin aria-hidden size={16} />
                    <span>
                      <strong>{location.name}</strong>
                      <small>{location.regency} · {location.project}</small>
                    </span>
                    <ChevronRight aria-hidden size={15} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className={styles.topbarActions}>
            <button
              type="button"
              className={styles.actionIndicator}
              onClick={() => navigate("actions")}
              aria-label={`${PROTOTYPE_SUMMARY.awaitingDecision} tindakan menunggu`}
            >
              <Bell aria-hidden size={18} />
              <span>{PROTOTYPE_SUMMARY.awaitingDecision}</span>
            </button>
            <button type="button" className={styles.userButton} aria-label="Konteks pengguna">
              <span className={styles.avatar}>HD</span>
              <span className={styles.userWords}>
                <strong>Hery Dermanto</strong>
                <small>Program Director</small>
              </span>
              <ChevronDown aria-hidden size={15} />
            </button>
          </div>
        </header>

        <main id="prototype-main" className={styles.main} tabIndex={-1}>
          {view === "command" ? (
            <CommandCentre
              scope={scope}
              onScopeChange={setScope}
              onNavigate={navigate}
              onOpenLocation={openLocation}
              onOpenDrawer={openDrawer}
            />
          ) : null}
          {view === "locations" ? (
            <LocationMonitor onOpenLocation={openLocation} />
          ) : null}
          {view === "location" ? (
            <LocationWorkspace
              location={selectedLocation}
              onNavigate={navigate}
              onStartReport={() => navigate("report")}
              onOpenDrawer={openDrawer}
            />
          ) : null}
          {view === "report" ? (
            <DailyReportFlow
              location={selectedLocation}
              onLocationChange={setSelectedLocation}
              onNavigate={navigate}
              onToast={setToast}
            />
          ) : null}
          {view === "progress" ? (
            <ProgressVariance onOpenLocation={openLocation} />
          ) : null}
          {view === "actions" ? (
            <ActionCentre
              onOpenDrawer={openDrawer}
              onOpenLocation={openLocation}
            />
          ) : null}
          {view === "ai" ? (
            <AiPortfolioPulse onOpenLocation={openLocation} />
          ) : null}
        </main>
      </div>

      <nav className={styles.mobileBottomNav} aria-label="Navigasi bawah prototype">
        {[
          { view: "command" as const, label: "Ringkasan", icon: BarChart3 },
          { view: "actions" as const, label: "Tindakan", icon: ClipboardCheck },
          { view: "report" as const, label: "Lapor", icon: FileText },
          { view: "locations" as const, label: "Lokasi", icon: MapPin },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.view}
              onClick={() => navigate(item.view)}
              className={item.view === view ? styles.mobileNavActive : undefined}
              aria-current={item.view === view ? "page" : undefined}
            >
              <Icon aria-hidden size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button type="button" onClick={openMobileMenu}>
          <Menu aria-hidden size={20} />
          <span>Menu</span>
        </button>
      </nav>

      {mobileMenuOpen ? (
        <div className={styles.mobileMenuLayer}>
          <button
            type="button"
            className={styles.drawerBackdrop}
            aria-label="Tutup menu"
            onClick={closeMobileMenu}
          />
          <div className={styles.mobileMenuSheet} role="dialog" aria-modal="true" aria-label="Semua menu prototype">
            <div className={styles.mobileSheetHeader}>
              <div>
                <strong>Semua menu</strong>
                <span>Portfolio nasional</span>
              </div>
              <button
                ref={mobileMenuCloseRef}
                type="button"
                className={styles.iconButton}
                aria-label="Tutup menu"
                onClick={closeMobileMenu}
              >
                <X aria-hidden size={20} />
              </button>
            </div>
            {NAV_GROUPS.map((group) => (
              <section key={group.label}>
                <p>{group.label}</p>
                <div>
                  {group.items.map((item, index) => {
                    const Icon = item.icon;
                    return (
                      <button
                        type="button"
                        key={`${group.label}-${item.label}-${index}`}
                        onClick={() => navigate(item.view)}
                      >
                        <Icon aria-hidden size={18} />
                        <span>{item.label}</span>
                        {item.count ? <em>{item.count}</em> : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {drawerItem ? (
        <ContextDrawer
          item={drawerItem}
          onClose={closeDrawer}
          onOpenLocation={() => {
            const location = PROTOTYPE_LOCATIONS.find((row) => row.id === drawerItem.locationId);
            closeDrawer();
            if (location) openLocation(location);
          }}
          closeRef={drawerCloseRef}
        />
      ) : null}

      <div className={styles.toastRegion} aria-live="polite" aria-atomic="true">
        {toast ? (
          <div className={styles.toast}>
            <CheckCircle2 aria-hidden size={18} />
            {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CommandCentre({
  scope,
  onScopeChange,
  onNavigate,
  onOpenLocation,
  onOpenDrawer,
}: {
  scope: string;
  onScopeChange: (scope: string) => void;
  onNavigate: (view: PrototypeView) => void;
  onOpenLocation: (location: PrototypeLocation, next?: PrototypeView) => void;
  onOpenDrawer: (item: PrototypeException, trigger: HTMLElement) => void;
}) {
  const [state, setState] = useState<DemoState>("ready");
  const [metricFilter, setMetricFilter] = useState<string>("all");
  const [province, setProvince] = useState("Semua provinsi");
  const [status, setStatus] = useState("Semua status");

  const scopedLocations = useMemo(() => {
    if (state === "empty") return [];
    return PROTOTYPE_LOCATIONS.filter((location) => {
      if (province !== "Semua provinsi" && location.province !== province) return false;
      if (status !== "Semua status" && location.health !== status) return false;
      if (metricFilter === "submitted" && ["belum_ada", "draft"].includes(location.reportStatus)) return false;
      if (metricFilter === "missing" && location.reportStatus !== "belum_ada") return false;
      if (metricFilter === "deviation" && location.deviationPct >= -5) return false;
      if (metricFilter === "critical" && location.health !== "kritis") return false;
      return true;
    });
  }, [metricFilter, province, state, status]);

  const resetState = () => {
    setState("ready");
    setMetricFilter("all");
    setProvince("Semua provinsi");
    setStatus("Semua status");
  };

  const metrics = [
    {
      key: "all",
      label: "Lokasi aktif",
      value: PROTOTYPE_SUMMARY.active,
      detail: "dalam scope",
      tone: styles.metricNeutral,
    },
    {
      key: "submitted",
      label: "Sudah melapor",
      value: PROTOTYPE_SUMMARY.submitted,
      detail: "hari ini",
      tone: styles.metricGood,
    },
    {
      key: "missing",
      label: "Belum melapor",
      value: PROTOTYPE_SUMMARY.missing,
      detail: "perlu dihubungi",
      tone: styles.metricWarning,
    },
    {
      key: "deviation",
      label: "Deviasi negatif",
      value: PROTOTYPE_SUMMARY.negativeDeviation,
      detail: "di bawah −5 poin",
      tone: styles.metricDanger,
    },
    {
      key: "critical",
      label: "Kendala kritis",
      value: PROTOTYPE_SUMMARY.criticalIssues,
      detail: "butuh mitigasi",
      tone: styles.metricDanger,
    },
    {
      key: "actions",
      label: "Menunggu keputusan",
      value: PROTOTYPE_SUMMARY.awaitingDecision,
      detail: "lintas proyek",
      tone: styles.metricAction,
    },
  ];

  return (
    <div data-testid="command-centre">
      <PageIntro
        eyebrow="Portfolio nasional · 120 lokasi mock"
        title="Kondisi yang membutuhkan perhatian hari ini"
        description="Status pelaksanaan, kelengkapan laporan, dan keputusan lintas proyek—diurutkan berdasarkan urgensi."
        actions={
          <>
            <label className={styles.inlineField}>
              <span className={styles.srOnly}>Scope portfolio</span>
              <Building2 aria-hidden size={16} />
              <select value={scope} onChange={(event) => onScopeChange(event.target.value)}>
                <option>Semua proyek</option>
                <option>KNMP Pantura</option>
                <option>KNMP Sumatera</option>
                <option>KNMP Sulawesi</option>
              </select>
            </label>
            <PrimaryButton onClick={() => onNavigate("actions")}>
              Buka antrean tindakan <ArrowRight aria-hidden size={16} />
            </PrimaryButton>
          </>
        }
      />

      <div className={styles.dataToolbar}>
        <div className={styles.freshness}>
          <span className={styles.liveDot} />
          <strong>Data tersinkron</strong>
          <span>{PROTOTYPE_DATA_AS_OF}</span>
        </div>
        <div className={styles.quickFilters}>
          <label>
            <span className={styles.srOnly}>Filter provinsi</span>
            <select value={province} onChange={(event) => setProvince(event.target.value)}>
              <option>Semua provinsi</option>
              {[...new Set(PROTOTYPE_LOCATIONS.map((row) => row.province))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={styles.srOnly}>Filter kesehatan</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option>Semua status</option>
              <option value="kritis">Kritis</option>
              <option value="waspada">Perlu perhatian</option>
              <option value="terkendali">Terkendali</option>
              <option value="selesai">Selesai</option>
            </select>
          </label>
          <label>
            <span className={styles.srOnly}>Simulasi state</span>
            <select value={state} onChange={(event) => setState(event.target.value as DemoState)}>
              <option value="ready">State: normal</option>
              <option value="loading">State: loading</option>
              <option value="empty">State: empty</option>
              <option value="error">State: error</option>
            </select>
          </label>
          {(metricFilter !== "all" || province !== "Semua provinsi" || status !== "Semua status") ? (
            <button type="button" className={styles.clearButton} onClick={resetState}>
              <X aria-hidden size={15} /> Bersihkan
            </button>
          ) : null}
        </div>
      </div>

      {state !== "ready" ? (
        <StatePanel state={state} onRetry={resetState} />
      ) : (
        <>
          <section className={styles.metricStrip} aria-label="Ringkasan status portfolio">
            {metrics.map((metric) => (
              <button
                type="button"
                key={metric.key}
                className={cx(
                  styles.metricSegment,
                  metric.tone,
                  metricFilter === metric.key && styles.metricSegmentActive,
                )}
                aria-pressed={metricFilter === metric.key}
                onClick={() => {
                  if (metric.key === "actions") onNavigate("actions");
                  else setMetricFilter(metric.key);
                }}
              >
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.detail}</small>
              </button>
            ))}
          </section>

          <div className={styles.commandGrid}>
            <section className={cx(styles.panel, styles.submissionPanel)}>
              <SectionHeading
                title="Monitor laporan hari ini"
                description={`${scopedLocations.length} lokasi sesuai filter · batas submit 18.00 WIB`}
                action={
                  <button type="button" className={styles.textButton} onClick={() => onNavigate("locations")}>
                    Lihat semua lokasi <ArrowRight aria-hidden size={14} />
                  </button>
                }
              />
              <div className={styles.submissionSummary}>
                {[
                  ["Belum ada", PROTOTYPE_SUMMARY.missing, styles.report_belum_ada],
                  ["Draft", PROTOTYPE_SUMMARY.draft, styles.report_draft],
                  ["Dikirim", PROTOTYPE_SUMMARY.sent, styles.report_dikirim],
                  ["Disetujui", PROTOTYPE_SUMMARY.approved, styles.report_disetujui],
                  ["Final", PROTOTYPE_SUMMARY.final, styles.report_final],
                ].map(([label, value, tone]) => (
                  <button
                    type="button"
                    key={String(label)}
                    className={String(tone)}
                    onClick={() => {
                      if (label === "Belum ada") setMetricFilter("missing");
                      else onNavigate("locations");
                    }}
                  >
                    <span>{String(value)}</span>
                    <small>{String(label)}</small>
                  </button>
                ))}
              </div>
              <div className={styles.submissionRows}>
                {scopedLocations.slice(0, 8).map((location) => (
                  <button
                    type="button"
                    key={location.id}
                    onClick={() => onOpenLocation(location)}
                  >
                    <span className={cx(styles.healthMark, toneForHealth(location.health))} />
                    <span className={styles.submissionName}>
                      <strong>{location.name}</strong>
                      <small>{location.project} · {location.owner ?? "PIC belum ditetapkan"}</small>
                    </span>
                    <StatusBadge
                      label={REPORT_LABEL[location.reportStatus]}
                      tone={toneForReport(location.reportStatus)}
                    />
                    <span className={styles.submissionTime}>
                      {location.reportTime ?? `${location.delayHours} jam terlambat`}
                    </span>
                    <ChevronRight aria-hidden size={16} />
                  </button>
                ))}
              </div>
            </section>

            <section className={cx(styles.panel, styles.exceptionPanel)}>
              <SectionHeading
                title="Antrean exception"
                description="Diurutkan keselamatan → jadwal → blocker → laporan"
                action={
                  <button type="button" className={styles.textButton} onClick={() => onNavigate("actions")}>
                    {PROTOTYPE_EXCEPTIONS.length} item <ArrowRight aria-hidden size={14} />
                  </button>
                }
              />
              <div className={styles.exceptionList}>
                {PROTOTYPE_EXCEPTIONS.slice(0, 6).map((item) => (
                  <ExceptionItem key={item.id} item={item} onOpen={onOpenDrawer} />
                ))}
              </div>
            </section>

            <section className={cx(styles.panel, styles.regionPanel)}>
              <SectionHeading
                title="Sebaran status wilayah"
                description="Pengganti peta sampai coverage koordinat tervalidasi"
              />
              <div className={styles.regionList}>
                {provinceDistribution(PROTOTYPE_LOCATIONS).map((region) => (
                  <button
                    type="button"
                    key={region.province}
                    onClick={() => setProvince(region.province)}
                  >
                    <span>
                      <strong>{region.province}</strong>
                      <small>{region.total} lokasi · {region.missing} belum melapor</small>
                    </span>
                    <span className={styles.regionRisk}>
                      <em>{region.critical}</em> kritis
                    </span>
                    <span className={region.averageDeviation < -5 ? styles.negativeText : styles.positiveText}>
                      {region.averageDeviation > 0 ? "+" : ""}{formatPct(region.averageDeviation)}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className={cx(styles.panel, styles.activityPanel)}>
              <SectionHeading
                title="Aktivitas bermakna"
                description="Perubahan status dan bukti, bukan log mentah"
              />
              <ol className={styles.activityList}>
                {PROTOTYPE_ACTIVITIES.map((item) => (
                  <li key={item.id} className={item.important ? styles.activityImportant : undefined}>
                    <span className={styles.activityIcon}>
                      {item.kind === "kendala" ? <AlertTriangle aria-hidden size={16} /> : null}
                      {item.kind === "laporan" ? <FileText aria-hidden size={16} /> : null}
                      {item.kind === "solusi" ? <Wrench aria-hidden size={16} /> : null}
                      {item.kind === "approval" ? <CheckCircle2 aria-hidden size={16} /> : null}
                      {item.kind === "progress" ? <TrendingUp aria-hidden size={16} /> : null}
                      {item.kind === "dokumen" ? <FolderOpen aria-hidden size={16} /> : null}
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.context}</small>
                    </span>
                    <time>{item.time}</time>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function ExceptionItem({
  item,
  onOpen,
}: {
  item: PrototypeException;
  onOpen: (item: PrototypeException, trigger: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className={styles.exceptionItem}
      onClick={(event) => onOpen(item, event.currentTarget)}
      data-testid="open-exception"
    >
      <span className={cx(styles.exceptionRail, styles[`severity_${item.severity}`])} />
      <span className={styles.exceptionMain}>
        <span className={styles.exceptionTitleRow}>
          <StatusBadge
            label={SEVERITY_LABEL[item.severity]}
            tone={styles[`severity_${item.severity}`]}
          />
          <em>{item.category}</em>
          <time>{item.age}</time>
        </span>
        <strong>{item.title}</strong>
        <small>{item.locationName} · {item.project}</small>
        <span className={styles.exceptionAction}>
          {item.owner ?? "PIC belum ditetapkan"} · {item.nextAction}
        </span>
      </span>
      <ChevronRight aria-hidden size={18} />
    </button>
  );
}

function LocationMonitor({
  onOpenLocation,
}: {
  onOpenLocation: (location: PrototypeLocation, next?: PrototypeView) => void;
}) {
  const [query, setQuery] = useState("");
  const [province, setProvince] = useState("Semua provinsi");
  const [health, setHealth] = useState("Semua kesehatan");
  const [report, setReport] = useState("Semua laporan");
  const [sort, setSort] = useState("urgency");
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [savedView, setSavedView] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const result = PROTOTYPE_LOCATIONS.filter((location) => {
      if (
        normalized &&
        ![location.name, location.project, location.owner ?? "", location.province]
          .join(" ")
          .toLowerCase()
          .includes(normalized)
      ) return false;
      if (province !== "Semua provinsi" && location.province !== province) return false;
      if (health !== "Semua kesehatan" && location.health !== health) return false;
      if (report !== "Semua laporan" && location.reportStatus !== report) return false;
      return true;
    });

    return result.sort((a, b) => {
      if (sort === "deviation") return a.deviationPct - b.deviationPct;
      if (sort === "progress") return b.reportedPct - a.reportedPct;
      if (sort === "activity") return a.lastActivity.localeCompare(b.lastActivity);
      const urgency = { kritis: 0, waspada: 1, terkendali: 2, selesai: 3 };
      return urgency[a.health] - urgency[b.health] || a.deviationPct - b.deviationPct;
    });
  }, [health, province, query, report, sort]);

  const clearFilters = () => {
    setQuery("");
    setProvince("Semua provinsi");
    setHealth("Semua kesehatan");
    setReport("Semua laporan");
    setSavedView(null);
  };

  const applySavedView = (name: string) => {
    setSavedView(name);
    if (name === "Lokasi paling berisiko") {
      setHealth("kritis");
      setReport("Semua laporan");
    } else if (name === "Belum melapor hari ini") {
      setReport("belum_ada");
      setHealth("Semua kesehatan");
    } else {
      clearFilters();
      setSavedView(name);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasFilters =
    query ||
    province !== "Semua provinsi" ||
    health !== "Semua kesehatan" ||
    report !== "Semua laporan";

  return (
    <div data-testid="location-monitor">
      <PageIntro
        eyebrow="Pelaksanaan · seluruh lokasi"
        title="Monitor 120 lokasi tanpa kehilangan prioritas"
        description="Cari, kelompokkan, dan tindak lanjuti lokasi berdasarkan submission, deviasi, kendala, PIC, dan aktivitas terakhir."
        actions={
          <PrimaryButton onClick={() => onOpenLocation(PROTOTYPE_LOCATIONS[0], "report")}>
            <FileText aria-hidden size={16} /> Buat laporan
          </PrimaryButton>
        }
      />

      <section className={styles.savedViews} aria-label="Saved views prototype">
        <span>Saved view</span>
        {["Semua lokasi", "Lokasi paling berisiko", "Belum melapor hari ini"].map((name) => (
          <button
            type="button"
            key={name}
            onClick={() => applySavedView(name)}
            className={savedView === name ? styles.savedViewActive : undefined}
          >
            {name}
          </button>
        ))}
        <button type="button" className={styles.addViewButton}>
          + Simpan tampilan
        </button>
      </section>

      <section className={styles.filterBar} aria-label="Filter lokasi">
        <label className={styles.searchControl}>
          <Search aria-hidden size={16} />
          <span className={styles.srOnly}>Cari lokasi</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari lokasi, proyek, atau PIC"
          />
        </label>
        <label>
          <span className={styles.srOnly}>Provinsi</span>
          <select value={province} onChange={(event) => setProvince(event.target.value)}>
            <option>Semua provinsi</option>
            {[...new Set(PROTOTYPE_LOCATIONS.map((row) => row.province))].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={styles.srOnly}>Kesehatan lokasi</span>
          <select value={health} onChange={(event) => setHealth(event.target.value)}>
            <option>Semua kesehatan</option>
            <option value="kritis">Kritis</option>
            <option value="waspada">Perlu perhatian</option>
            <option value="terkendali">Terkendali</option>
            <option value="selesai">Selesai</option>
          </select>
        </label>
        <label>
          <span className={styles.srOnly}>Status laporan</span>
          <select value={report} onChange={(event) => setReport(event.target.value)}>
            <option>Semua laporan</option>
            <option value="belum_ada">Belum ada</option>
            <option value="draft">Draft</option>
            <option value="dikirim">Dikirim</option>
            <option value="disetujui">Disetujui</option>
            <option value="final">Final</option>
          </select>
        </label>
        <label>
          <span className={styles.srOnly}>Urutkan</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="urgency">Urut: urgensi</option>
            <option value="deviation">Deviasi terburuk</option>
            <option value="progress">Progress tertinggi</option>
            <option value="activity">Aktivitas terakhir</option>
          </select>
        </label>
        {hasFilters ? (
          <button type="button" className={styles.clearButton} onClick={clearFilters}>
            <X aria-hidden size={15} /> Bersihkan
          </button>
        ) : null}
        <div className={styles.layoutToggle} role="group" aria-label="Tampilan lokasi">
          <IconButton
            label="Tampilan daftar"
            className={layout === "list" ? styles.iconButtonActive : undefined}
            onClick={() => setLayout("list")}
          >
            <List aria-hidden size={17} />
          </IconButton>
          <IconButton
            label="Tampilan grid"
            className={layout === "grid" ? styles.iconButtonActive : undefined}
            onClick={() => setLayout("grid")}
          >
            <LayoutGrid aria-hidden size={17} />
          </IconButton>
        </div>
      </section>

      <div className={styles.resultToolbar}>
        <span><strong>{filtered.length}</strong> lokasi ditampilkan</span>
        {selected.size > 0 ? (
          <div className={styles.bulkBar}>
            <strong>{selected.size} dipilih</strong>
            <button type="button">Minta update laporan</button>
            <button type="button">Tetapkan PIC</button>
            <button type="button" onClick={() => setSelected(new Set())}>Batal</button>
          </div>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <StatePanel state="empty" onRetry={clearFilters} />
      ) : (
        <section className={layout === "grid" ? styles.locationGrid : styles.locationList}>
          {filtered.slice(0, 40).map((location) => (
            <LocationItem
              key={location.id}
              location={location}
              selected={selected.has(location.id)}
              onSelect={() => toggleSelected(location.id)}
              onOpen={() => onOpenLocation(location)}
              grid={layout === "grid"}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function LocationItem({
  location,
  selected,
  onSelect,
  onOpen,
  grid,
}: {
  location: PrototypeLocation;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  grid: boolean;
}) {
  return (
    <article className={cx(styles.locationItem, grid && styles.locationItemGrid, selected && styles.locationSelected)}>
      <label className={styles.rowCheckbox}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Pilih ${location.name}`}
        />
      </label>
      <button type="button" className={styles.locationOpen} onClick={onOpen}>
        <span className={styles.locationIdentity}>
          <span className={cx(styles.healthMark, toneForHealth(location.health))} />
          <span>
            <strong>{location.name}</strong>
            <small>{location.regency}, {location.province} · {location.project}</small>
          </span>
        </span>
        <span className={styles.locationStatus}>
          <StatusBadge label={HEALTH_LABEL[location.health]} tone={toneForHealth(location.health)} />
          <StatusBadge label={REPORT_LABEL[location.reportStatus]} tone={toneForReport(location.reportStatus)} />
        </span>
        <span className={styles.locationProgress}>
          <span>
            <strong>{formatPct(location.reportedPct)}</strong>
            <small>Progress Dilaporkan</small>
          </span>
          <ProgressTrack value={location.reportedPct} plan={location.planPct} compact />
        </span>
        <span className={location.deviationPct < 0 ? styles.negativeText : styles.positiveText}>
          <strong>{location.deviationPct > 0 ? "+" : ""}{formatPct(location.deviationPct)}</strong>
          <small>deviasi</small>
        </span>
        <span className={styles.locationIssues}>
          <strong>{location.issueCount}</strong>
          <small>kendala</small>
        </span>
        <span className={styles.locationOwner}>
          <strong>{location.owner ?? "Belum ada PIC"}</strong>
          <small>{location.lastActivity}</small>
        </span>
        <span className={styles.locationPrimaryAction}>
          {location.reportStatus === "belum_ada" ? "Minta laporan" : location.health === "kritis" ? "Tinjau kendala" : "Buka lokasi"}
          <ChevronRight aria-hidden size={16} />
        </span>
      </button>
    </article>
  );
}

function LocationWorkspace({
  location,
  onNavigate,
  onStartReport,
  onOpenDrawer,
}: {
  location: PrototypeLocation;
  onNavigate: (view: PrototypeView) => void;
  onStartReport: () => void;
  onOpenDrawer: (item: PrototypeException, trigger: HTMLElement) => void;
}) {
  const exception = PROTOTYPE_EXCEPTIONS.find((item) => item.locationId === location.id);
  const [tab, setTab] = useState("Ringkasan");

  return (
    <div data-testid="location-workspace">
      <button type="button" className={styles.backButton} onClick={() => onNavigate("locations")}>
        <ArrowLeft aria-hidden size={16} /> Kembali ke monitor lokasi
      </button>
      <header className={styles.locationHero}>
        <div className={styles.locationHeroMain}>
          <div className={styles.locationHeroTitle}>
            <span className={cx(styles.healthMarkLarge, toneForHealth(location.health))} />
            <div>
              <p className={styles.eyebrow}>{location.project}</p>
              <h1 tabIndex={-1}>{location.name}</h1>
              <p>{location.regency}, {location.province} · {location.company}</p>
            </div>
          </div>
          <div className={styles.locationHeroBadges}>
            <StatusBadge label={HEALTH_LABEL[location.health]} tone={toneForHealth(location.health)} />
            <StatusBadge label={location.status} tone={styles.statusNeutral} />
          </div>
        </div>
        <dl className={styles.locationHeroFacts}>
          <div>
            <dt>Progress Dilaporkan</dt>
            <dd>{formatPct(location.reportedPct)}</dd>
          </div>
          <div>
            <dt>Rencana s.d. 28 Juli</dt>
            <dd>{formatPct(location.planPct)}</dd>
          </div>
          <div>
            <dt>Deviasi Dilaporkan</dt>
            <dd className={location.deviationPct < 0 ? styles.negativeText : styles.positiveText}>
              {location.deviationPct > 0 ? "+" : ""}{formatPct(location.deviationPct)}
            </dd>
          </div>
          <div>
            <dt>Laporan terakhir</dt>
            <dd>{REPORT_LABEL[location.reportStatus]} · {location.reportTime ?? "—"}</dd>
          </div>
          <div>
            <dt>PIC</dt>
            <dd>{location.owner ?? "Belum ditetapkan"}</dd>
          </div>
        </dl>
        <div className={styles.locationHeroActions}>
          <SecondaryButton onClick={() => onNavigate("progress")}>
            <TrendingUp aria-hidden size={16} /> Buka progress
          </SecondaryButton>
          <PrimaryButton onClick={onStartReport}>
            <FileText aria-hidden size={16} /> Isi laporan hari ini
          </PrimaryButton>
        </div>
      </header>

      <nav className={styles.workspaceTabs} aria-label="Bagian workspace lokasi">
        {["Ringkasan", "Laporan", "Progress", "Kendala", "Foto", "RAB/BOQ", "Keuangan", "Dokumen"].map((item) => (
          <button
            type="button"
            key={item}
            aria-current={tab === item ? "page" : undefined}
            className={tab === item ? styles.workspaceTabActive : undefined}
            onClick={() => {
              setTab(item);
              if (item === "Laporan") onStartReport();
              if (item === "Progress") onNavigate("progress");
            }}
          >
            {item}
          </button>
        ))}
      </nav>

      <div className={styles.workspaceGrid}>
        <section className={cx(styles.panel, styles.healthSummary)}>
          <SectionHeading title="Kesehatan lokasi" description="Ringkasan untuk keputusan hari ini" />
          <div className={styles.healthHeadline}>
            {location.health === "kritis" ? <ShieldAlert aria-hidden size={26} /> : <CheckCircle2 aria-hidden size={26} />}
            <div>
              <strong>
                {location.health === "kritis"
                  ? "Jadwal dan kendala membutuhkan intervensi"
                  : "Pelaksanaan dalam rentang kendali"}
              </strong>
              <p>
                {location.health === "kritis"
                  ? "Selesaikan blocker sebelum target pekerjaan hari ini terdampak lebih jauh."
                  : "Tidak ada blocker kritis; pantau submission dan target mingguan."}
              </p>
            </div>
          </div>
          <div className={styles.progressComparison}>
            <div>
              <span>Rencana</span>
              <strong>{formatPct(location.planPct)}</strong>
            </div>
            <ProgressTrack value={location.reportedPct} plan={location.planPct} />
            <div>
              <span>Dilaporkan</span>
              <strong>{formatPct(location.reportedPct)}</strong>
            </div>
          </div>
          <div className={styles.evidenceLevels}>
            <div><span>Dilaporkan</span><strong>{formatPct(location.reportedPct)}</strong></div>
            <div><span>Terverifikasi</span><strong>{formatPct(location.verifiedPct)}</strong></div>
            <div><span>Final</span><strong>{formatPct(location.finalPct)}</strong></div>
          </div>
          <p className={styles.calculationNote}>
            <HelpCircle aria-hidden size={14} /> Data mock · level status dipisahkan untuk clarity, bukan perubahan formula produksi.
          </p>
        </section>

        <section className={cx(styles.panel, styles.todayPanel)}>
          <SectionHeading
            title="Pekerjaan aktif hari ini"
            description="Target lapangan dan bukti terakhir"
          />
          <div className={styles.activeWork}>
            <span className={styles.workIcon}><HardHat aria-hidden size={20} /></span>
            <div>
              <strong>{location.latestWork}</strong>
              <p>Target 18,5 m³ · progres hari ini 7,2 m³</p>
              <div className={styles.inlineProgress}><span style={{ width: "39%" }} /></div>
            </div>
          </div>
          <dl className={styles.compactFacts}>
            <div><dt>Cuaca</dt><dd>Berawan · 29°C</dd></div>
            <div><dt>Tenaga</dt><dd>42 orang</dd></div>
            <div><dt>Alat utama</dt><dd>3 unit aktif</dd></div>
          </dl>
        </section>

        <section className={cx(styles.panel, styles.blockerPanel)}>
          <SectionHeading
            title="Kendala & solusi"
            description={`${location.issueCount} kendala belum selesai`}
            action={
              exception ? (
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={(event) => onOpenDrawer(exception, event.currentTarget)}
                >
                  Detail <ChevronRight aria-hidden size={14} />
                </button>
              ) : undefined
            }
          />
          {exception ? (
            <div className={styles.blockerContent}>
              <StatusBadge label={SEVERITY_LABEL[exception.severity]} tone={styles[`severity_${exception.severity}`]} />
              <h3>{exception.title}</h3>
              <p>{exception.detail}</p>
              <div className={styles.recommendationCompact}>
                <Wrench aria-hidden size={16} />
                <span>{exception.proposedSolution ?? "Solusi belum tersedia"}</span>
              </div>
            </div>
          ) : (
            <div className={styles.miniEmpty}>
              <CheckCircle2 aria-hidden size={24} />
              <strong>Tidak ada kendala kritis</strong>
              <span>Kendala operasional masih dalam kendali PIC.</span>
            </div>
          )}
        </section>

        <section className={cx(styles.panel, styles.decisionPanel)}>
          <SectionHeading title="Keputusan tertunda" description="Yang menahan pekerjaan atau administrasi" />
          <ul className={styles.decisionList}>
            <li>
              <span><Clock3 aria-hidden size={16} /></span>
              <div><strong>Persetujuan metode kerja revetment</strong><small>Owner · jatuh tempo hari ini</small></div>
              <ChevronRight aria-hidden size={16} />
            </li>
            <li>
              <span><FileCheck2 aria-hidden size={16} /></span>
              <div><strong>Verifikasi hasil uji material</strong><small>Konsultan · 4 jam</small></div>
              <ChevronRight aria-hidden size={16} />
            </li>
          </ul>
        </section>

        <section className={cx(styles.panel, styles.photoPanel)}>
          <SectionHeading title="Bukti terbaru" description={location.hasPhoto ? "Foto lapangan · 24 menit lalu" : "Belum ada foto hari ini"} />
          {location.hasPhoto ? (
            <div className={styles.photoMock} role="img" aria-label={location.photoLabel ?? "Bukti foto lapangan mock"}>
              <div className={styles.photoSky} />
              <div className={styles.photoStructure} />
              <div className={styles.photoGround} />
              <span><Camera aria-hidden size={16} /> {location.photoLabel}</span>
            </div>
          ) : (
            <div className={styles.miniEmpty}>
              <Camera aria-hidden size={25} />
              <strong>Belum ada bukti foto</strong>
              <span>Minta tim menambahkan foto pada laporan hari ini.</span>
            </div>
          )}
        </section>

        <section className={cx(styles.panel, styles.milestonePanel)}>
          <SectionHeading title="Milestone terdekat" description="Minggu 18 dari 32" />
          <ol className={styles.milestoneList}>
            <li className={styles.milestoneDone}><Check aria-hidden size={14} /><span>Mobilisasi utama</span><time>12 Jun</time></li>
            <li className={styles.milestoneCurrent}><span>18</span><strong>Struktur utama 50%</strong><time>31 Jul</time></li>
            <li><span>22</span><span>Atap & utilitas</span><time>28 Agu</time></li>
            <li><span>29</span><span>Testing & commissioning</span><time>16 Okt</time></li>
          </ol>
        </section>
      </div>
    </div>
  );
}

type ReportFormData = {
  locationId: string;
  date: string;
  workItem: string;
  volume: string;
  unit: string;
  workers: string;
  equipment: string;
  weather: string;
  issue: string;
  solution: string;
  needsDecision: boolean;
  photoAdded: boolean;
};

const REPORT_STEPS = [
  "Konteks",
  "Pekerjaan",
  "Sumber daya",
  "Kendala & bukti",
  "Tinjau",
] as const;

function DailyReportFlow({
  location,
  onLocationChange,
  onNavigate,
  onToast,
}: {
  location: PrototypeLocation;
  onLocationChange: (location: PrototypeLocation) => void;
  onNavigate: (view: PrototypeView) => void;
  onToast: (message: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [savedAt, setSavedAt] = useState("Belum ada perubahan");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const confirmTriggerRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState<ReportFormData>({
    locationId: location.id,
    date: "2026-07-28",
    workItem: location.latestWork,
    volume: "",
    unit: "m³",
    workers: "42",
    equipment: "3",
    weather: "Berawan",
    issue: "",
    solution: "",
    needsDecision: false,
    photoAdded: false,
  });

  useEffect(() => {
    if (!confirmOpen) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setConfirmOpen(false);
      requestAnimationFrame(() => confirmTriggerRef.current?.focus());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  const update = <K extends keyof ReportFormData>(key: K, value: ReportFormData[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSavedAt("Perubahan belum disimpan");
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const saveDraft = () => {
    setSavedAt("Tersimpan lokal · baru saja");
    onToast("Draft laporan disimpan lokal pada perangkat ini.");
    try {
      localStorage.setItem("marlin-ui-prototype-report", JSON.stringify(form));
    } catch {
      // Prototype tetap berfungsi bila browser memblokir localStorage.
    }
  };

  const validateStep = () => {
    const nextErrors: Record<string, string> = {};
    if (step === 0 && !form.locationId) nextErrors.locationId = "Pilih lokasi laporan.";
    if (step === 1) {
      if (!form.workItem.trim()) nextErrors.workItem = "Pilih pekerjaan yang dilaporkan.";
      const volume = Number(form.volume);
      if (!form.volume || !Number.isFinite(volume) || volume <= 0) {
        nextErrors.volume = "Masukkan volume lebih dari 0.";
      } else if (volume > 18.5) {
        nextErrors.volume = "Volume melebihi sisa target mock 18,5 m³.";
      }
    }
    if (step === 2 && Number(form.workers) < 1) nextErrors.workers = "Jumlah tenaga minimal 1.";
    if (step === 3 && form.needsDecision && !form.issue.trim()) {
      nextErrors.issue = "Jelaskan kendala yang membutuhkan keputusan.";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const goNext = () => {
    if (!validateStep()) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      });
      return;
    }
    setStep((current) => Math.min(REPORT_STEPS.length - 1, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const selected = PROTOTYPE_LOCATIONS.find((row) => row.id === form.locationId) ?? location;

  if (submitted) {
    return (
      <div className={styles.reportSuccess} data-testid="daily-report">
        <CheckCircle2 aria-hidden size={44} />
        <p className={styles.eyebrow}>Laporan berhasil dikirim · simulasi</p>
        <h1 tabIndex={-1}>Tim verifikator sudah menerima laporan</h1>
        <p>
          Status laporan {selected.name} menjadi <strong>Dikirim</strong>. Progress Dilaporkan baru
          dihitung setelah aturan produksi memproses data—prototype tidak menghitung ulang angka.
        </p>
        <dl>
          <div><dt>Lokasi</dt><dd>{selected.name}</dd></div>
          <div><dt>Tanggal kerja</dt><dd>28 Juli 2026</dd></div>
          <div><dt>Pekerjaan</dt><dd>{form.workItem}</dd></div>
          <div><dt>Volume</dt><dd>{form.volume} {form.unit}</dd></div>
          <div><dt>Bukti</dt><dd>{form.photoAdded ? "1 foto mock" : "Tidak ada foto"}</dd></div>
        </dl>
        <div className={styles.reportSuccessActions}>
          <SecondaryButton onClick={() => {
            setSubmitted(false);
            setStep(0);
          }}>
            Buat laporan lain
          </SecondaryButton>
          <PrimaryButton onClick={() => onNavigate("location")}>
            Kembali ke workspace <ArrowRight aria-hidden size={16} />
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.reportFlow} data-testid="daily-report">
      <button type="button" className={styles.backButton} onClick={() => onNavigate("location")}>
        <ArrowLeft aria-hidden size={16} /> Kembali ke workspace
      </button>
      <PageIntro
        eyebrow="Laporan lapangan · data mock"
        title="Catat pekerjaan hari ini"
        description={`${selected.name} · Selasa, 28 Juli 2026`}
        actions={
          <div className={styles.saveStatus} aria-live="polite">
            <span className={savedAt.startsWith("Tersimpan") ? styles.liveDot : styles.pendingDot} />
            {savedAt}
          </div>
        }
      />

      <div className={styles.reportLayout}>
        <aside className={styles.reportSteps} aria-label="Tahapan laporan">
          <ol>
            {REPORT_STEPS.map((label, index) => (
              <li key={label} className={cx(index === step && styles.stepActive, index < step && styles.stepDone)}>
                <button
                  type="button"
                  onClick={() => {
                    if (index < step || validateStep()) setStep(index);
                  }}
                  aria-current={index === step ? "step" : undefined}
                >
                  <span>{index < step ? <Check aria-hidden size={14} /> : index + 1}</span>
                  <strong>{label}</strong>
                </button>
              </li>
            ))}
          </ol>
          <div className={styles.reportContext}>
            <p>Lokasi aktif</p>
            <strong>{selected.name}</strong>
            <span>{selected.regency}</span>
            <StatusBadge
              label={REPORT_LABEL[selected.reportStatus]}
              tone={toneForReport(selected.reportStatus)}
            />
          </div>
        </aside>

        <form
          className={styles.reportForm}
          onSubmit={(event) => event.preventDefault()}
          noValidate
        >
          <div className={styles.reportMobileProgress}>
            <span>Langkah {step + 1} dari {REPORT_STEPS.length}</span>
            <strong>{REPORT_STEPS[step]}</strong>
            <div><span style={{ width: `${((step + 1) / REPORT_STEPS.length) * 100}%` }} /></div>
          </div>

          {step === 0 ? (
            <FormSection
              eyebrow="Langkah 1"
              title="Konfirmasi konteks laporan"
              description="Lokasi dan tanggal selalu terlihat selama pengisian."
            >
              <div className={styles.formGrid}>
                <Field label="Lokasi" required error={errors.locationId}>
                  <select
                    value={form.locationId}
                    onChange={(event) => {
                      update("locationId", event.target.value);
                      const next = PROTOTYPE_LOCATIONS.find((row) => row.id === event.target.value);
                      if (next) onLocationChange(next);
                    }}
                    aria-invalid={Boolean(errors.locationId)}
                  >
                    {PROTOTYPE_LOCATIONS.slice(0, 20).map((row) => (
                      <option value={row.id} key={row.id}>{row.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Tanggal kerja" required>
                  <input
                    type="date"
                    value={form.date}
                    max="2026-07-28"
                    onChange={(event) => update("date", event.target.value)}
                  />
                </Field>
              </div>
              <div className={styles.contextNotice}>
                <CalendarDays aria-hidden size={20} />
                <div>
                  <strong>Selasa, 28 Juli 2026</strong>
                  <p>Laporan unik untuk lokasi dan tanggal kerja. Perubahan pada prototype hanya tersimpan lokal.</p>
                </div>
              </div>
            </FormSection>
          ) : null}

          {step === 1 ? (
            <FormSection
              eyebrow="Langkah 2"
              title="Pekerjaan dan volume hari ini"
              description="Pilih item yang benar; sisa volume membantu mencegah input berlebih."
            >
              <Field label="Pekerjaan RAB" required error={errors.workItem}>
                <select
                  value={form.workItem}
                  onChange={(event) => update("workItem", event.target.value)}
                  aria-invalid={Boolean(errors.workItem)}
                  aria-describedby={errors.workItem ? "pekerjaan-rab-error" : undefined}
                >
                  {[...new Set([
                    selected.latestWork,
                    "Pemasangan batu revetment",
                    "Pekerjaan drainase kawasan",
                    "Fabrikasi rangka atap",
                  ])].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <div className={styles.workBalance}>
                <div><span>Volume kontrak</span><strong>125,0 m³</strong></div>
                <div><span>Sudah dilaporkan</span><strong>106,5 m³</strong></div>
                <div><span>Sisa tersedia</span><strong>18,5 m³</strong></div>
              </div>
              <div className={styles.volumeRow}>
                <Field label="Volume hari ini" required error={errors.volume}>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={form.volume}
                    placeholder="0,000"
                    step="0.001"
                    onChange={(event) => update("volume", event.target.value)}
                    aria-invalid={Boolean(errors.volume)}
                    aria-describedby={errors.volume ? "volume-hari-ini-error" : "volume-help"}
                  />
                </Field>
                <Field label="Satuan">
                  <select value={form.unit} onChange={(event) => update("unit", event.target.value)}>
                    <option>m³</option><option>m²</option><option>m</option><option>unit</option>
                  </select>
                </Field>
              </div>
              <p id="volume-help" className={styles.helpText}>Masukkan volume terpasang pada tanggal kerja, bukan kumulatif.</p>
            </FormSection>
          ) : null}

          {step === 2 ? (
            <FormSection
              eyebrow="Langkah 3"
              title="Sumber daya dan kondisi lapangan"
              description="Isi yang relevan; detail dapat dilengkapi Site Manager saat review."
            >
              <div className={styles.formGrid}>
                <Field label="Jumlah tenaga" required error={errors.workers}>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={form.workers}
                    onChange={(event) => update("workers", event.target.value)}
                    aria-invalid={Boolean(errors.workers)}
                  />
                </Field>
                <Field label="Alat utama aktif">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={form.equipment}
                    onChange={(event) => update("equipment", event.target.value)}
                  />
                </Field>
                <Field label="Cuaca">
                  <select value={form.weather} onChange={(event) => update("weather", event.target.value)}>
                    <option>Cerah</option><option>Berawan</option><option>Hujan ringan</option><option>Hujan lebat</option>
                  </select>
                </Field>
              </div>
              <details className={styles.optionalSection}>
                <summary><ChevronRight aria-hidden size={16} /> Tambahkan material dan alat rinci (opsional)</summary>
                <div className={styles.optionalBody}>
                  <p>Progressive disclosure mock: detail material/alat tidak dibutuhkan untuk melanjutkan.</p>
                </div>
              </details>
            </FormSection>
          ) : null}

          {step === 3 ? (
            <FormSection
              eyebrow="Langkah 4"
              title="Kendala, solusi, dan bukti"
              description="Kendala yang membutuhkan keputusan akan masuk Action Centre."
            >
              <Field label="Kendala hari ini" error={errors.issue}>
                <textarea
                  rows={4}
                  value={form.issue}
                  placeholder="Contoh: akses truk material tertutup pasang laut…"
                  onChange={(event) => update("issue", event.target.value)}
                  aria-invalid={Boolean(errors.issue)}
                  aria-describedby={errors.issue ? "kendala-hari-ini-error" : undefined}
                />
              </Field>
              <Field label="Solusi atau mitigasi yang diusulkan">
                <textarea
                  rows={3}
                  value={form.solution}
                  placeholder="Jelaskan tindakan yang sudah atau akan dilakukan…"
                  onChange={(event) => update("solution", event.target.value)}
                />
              </Field>
              <label className={styles.checkControl}>
                <input
                  type="checkbox"
                  checked={form.needsDecision}
                  onChange={(event) => update("needsDecision", event.target.checked)}
                />
                <span>
                  <strong>Butuh keputusan pimpinan</strong>
                  <small>Item akan muncul di Action Centre dengan konteks lokasi.</small>
                </span>
              </label>
              <button
                type="button"
                className={cx(styles.photoUpload, form.photoAdded && styles.photoUploadAdded)}
                onClick={() => update("photoAdded", !form.photoAdded)}
              >
                {form.photoAdded ? <CheckCircle2 aria-hidden size={24} /> : <Camera aria-hidden size={24} />}
                <span>
                  <strong>{form.photoAdded ? "1 foto mock ditambahkan" : "Tambahkan foto pekerjaan"}</strong>
                  <small>Simulasi upload · tidak mengakses kamera atau storage.</small>
                </span>
                <span>{form.photoAdded ? "Hapus" : "Pilih foto"}</span>
              </button>
            </FormSection>
          ) : null}

          {step === 4 ? (
            <FormSection
              eyebrow="Langkah 5"
              title="Tinjau sebelum mengirim"
              description="Pastikan volume, konteks, dan bukti sudah benar. Setelah dikirim, laporan masuk antrean verifikasi."
            >
              <dl className={styles.reviewList}>
                <div><dt>Lokasi</dt><dd>{selected.name}</dd></div>
                <div><dt>Tanggal kerja</dt><dd>28 Juli 2026</dd></div>
                <div><dt>Pekerjaan</dt><dd>{form.workItem}</dd></div>
                <div><dt>Volume hari ini</dt><dd>{form.volume || "—"} {form.unit}</dd></div>
                <div><dt>Tenaga / alat</dt><dd>{form.workers} orang · {form.equipment} alat</dd></div>
                <div><dt>Cuaca</dt><dd>{form.weather}</dd></div>
                <div><dt>Kendala</dt><dd>{form.issue || "Tidak ada kendala dicatat"}</dd></div>
                <div><dt>Solusi</dt><dd>{form.solution || "Belum ada solusi dicatat"}</dd></div>
                <div><dt>Bukti foto</dt><dd>{form.photoAdded ? "1 foto mock" : "Belum ada foto"}</dd></div>
                <div><dt>Butuh keputusan</dt><dd>{form.needsDecision ? "Ya · masuk Action Centre" : "Tidak"}</dd></div>
              </dl>
              <div className={styles.submitImpact}>
                <CircleAlert aria-hidden size={20} />
                <div>
                  <strong>Setelah dikirim</strong>
                  <p>Status menjadi Dikirim dan tidak dapat diedit sampai dikembalikan untuk koreksi. Prototype hanya mensimulasikan perubahan ini.</p>
                </div>
              </div>
            </FormSection>
          ) : null}

          <footer className={styles.reportFormActions}>
            <SecondaryButton onClick={saveDraft}>Simpan draft</SecondaryButton>
            <div>
              {step > 0 ? (
                <SecondaryButton onClick={() => setStep((current) => current - 1)}>
                  <ArrowLeft aria-hidden size={16} /> Sebelumnya
                </SecondaryButton>
              ) : null}
              {step < REPORT_STEPS.length - 1 ? (
                <PrimaryButton onClick={goNext}>
                  Lanjutkan <ArrowRight aria-hidden size={16} />
                </PrimaryButton>
              ) : (
                <PrimaryButton
                  onClick={() => {
                    confirmTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                    setConfirmOpen(true);
                  }}
                >
                  <Send aria-hidden size={16} /> Kirim laporan
                </PrimaryButton>
              )}
            </div>
          </footer>
        </form>
      </div>

      {confirmOpen ? (
        <ConfirmationDialog
          title="Kirim laporan untuk diverifikasi?"
          description={`${selected.name} · 28 Juli 2026 · ${form.volume} ${form.unit}. Setelah dikirim, laporan menunggu keputusan Site Manager.`}
          confirmLabel="Ya, kirim laporan"
          onClose={() => {
            setConfirmOpen(false);
            requestAnimationFrame(() => confirmTriggerRef.current?.focus());
          }}
          onConfirm={() => {
            setConfirmOpen(false);
            setSubmitted(true);
            onToast("Laporan terkirim ke antrean verifikasi.");
          }}
          cancelRef={cancelRef}
        />
      ) : null}
    </div>
  );
}

function FormSection({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.formSection}>
      <header>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div className={styles.formSectionBody}>{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  const errorId = `${label.replace(/\W+/g, "-").toLowerCase()}-error`;
  return (
    <label className={styles.field}>
      <span>{label}{required ? <em aria-hidden> *</em> : null}</span>
      {children}
      {error ? <small id={errorId} role="alert" className={styles.fieldError}>{error}</small> : null}
    </label>
  );
}

function ProgressVariance({
  onOpenLocation,
}: {
  onOpenLocation: (location: PrototypeLocation, next?: PrototypeView) => void;
}) {
  const critical = [...PROTOTYPE_LOCATIONS]
    .filter((location) => location.deviationPct < -5)
    .sort((a, b) => a.deviationPct - b.deviationPct)
    .slice(0, 12);
  const focus = critical[0] ?? PROTOTYPE_LOCATIONS[2];
  const weekly = Array.from({ length: 16 }, (_, index) => ({
    week: index + 1,
    plan: Math.min(74, oneDecimalLocal(3 + index * 4.7)),
    reported: Math.min(focus.reportedPct, oneDecimalLocal(2 + index * 3.4)),
    verified: Math.min(focus.verifiedPct, oneDecimalLocal(1.5 + index * 3.1)),
  }));

  return (
    <div data-testid="progress-variance">
      <PageIntro
        eyebrow="Analisis · status evidence eksplisit"
        title="Progress dan deviasi yang dapat ditindaklanjuti"
        description={`Data s.d. ${PROTOTYPE_DATA_AS_OF}. Progress Dilaporkan memakai status counted existing; prototype tidak mengubah formula.`}
        actions={<SecondaryButton><Filter aria-hidden size={16} /> Filter periode</SecondaryButton>}
      />

      <section className={styles.metricStrip}>
        {[
          ["Rencana portfolio", "58,4%", "s.d. minggu ini", styles.metricNeutral],
          ["Progress Dilaporkan", "49,7%", "dikirim + disetujui + final", styles.metricWarning],
          ["Progress Terverifikasi", "46,2%", "mock pembanding", styles.metricAction],
          ["Deviasi Dilaporkan", "−8,7 pt", "actual − plan", styles.metricDanger],
          ["Lokasi tertinggal", String(critical.length), "di bawah −5 poin", styles.metricDanger],
        ].map(([label, value, detail, tone]) => (
          <div className={cx(styles.metricSegment, String(tone))} key={String(label)}>
            <span>{String(label)}</span><strong>{String(value)}</strong><small>{String(detail)}</small>
          </div>
        ))}
      </section>

      <div className={styles.progressLayout}>
        <section className={cx(styles.panel, styles.trendPanel)}>
          <SectionHeading
            title={`Tren mingguan · ${focus.name}`}
            description="Rencana, Dilaporkan, dan Terverifikasi dipisahkan"
            action={<button type="button" className={styles.textButton} onClick={() => onOpenLocation(focus)}>Buka lokasi <ArrowRight aria-hidden size={14} /></button>}
          />
          <div className={styles.chartLegend}>
            <span><i className={styles.legendPlan} /> Rencana</span>
            <span><i className={styles.legendReported} /> Dilaporkan</span>
            <span><i className={styles.legendVerified} /> Terverifikasi</span>
          </div>
          <div className={styles.barChart} role="img" aria-label="Grafik tren progress rencana, dilaporkan, dan terverifikasi selama 16 minggu">
            <div className={styles.chartYAxis}><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>
            <div className={styles.chartPlot}>
              {weekly.map((point) => (
                <div className={styles.weekColumn} key={point.week}>
                  <div className={styles.weekBars}>
                    <span className={styles.planBar} style={{ height: `${point.plan}%` }} title={`Rencana ${formatPct(point.plan)}`} />
                    <span className={styles.reportedBar} style={{ height: `${point.reported}%` }} title={`Dilaporkan ${formatPct(point.reported)}`} />
                    <span className={styles.verifiedBar} style={{ height: `${point.verified}%` }} title={`Terverifikasi ${formatPct(point.verified)}`} />
                  </div>
                  <small>{point.week}</small>
                </div>
              ))}
            </div>
          </div>
          <p className={styles.chartCaption}>Minggu kontrak · arahkan pointer pada batang untuk nilai mock.</p>
        </section>

        <section className={cx(styles.panel, styles.laggingPanel)}>
          <SectionHeading title="Pekerjaan tertinggal" description="Urut berdasarkan dampak terhadap deviasi" />
          <div className={styles.laggingWorks}>
            {[
              ["Pemasangan batu revetment", "−12,4 pt", "Pasang laut mengurangi jam kerja efektif", "Mobilisasi shift malam"],
              ["Struktur bangunan TPI", "−7,8 pt", "Bekisting datang terlambat", "Alihkan 8 pekerja dari area selesai"],
              ["Drainase kawasan", "−4,1 pt", "Shop drawing belum disetujui", "Eskalasi review konsultan"],
            ].map(([name, delta, cause, action]) => (
              <article key={name}>
                <div><TrendingDown aria-hidden size={17} /><strong>{name}</strong><em>{delta}</em></div>
                <p>{cause}</p>
                <button type="button">{action} <ChevronRight aria-hidden size={14} /></button>
              </article>
            ))}
          </div>
        </section>

        <section className={cx(styles.panel, styles.deviationTablePanel)}>
          <SectionHeading title="Lokasi dengan deviasi terbesar" description="Klik untuk melihat data pembentuk dan tindakan" />
          <div className={styles.deviationRows}>
            {critical.map((location, index) => (
              <button type="button" key={location.id} onClick={() => onOpenLocation(location)}>
                <span className={styles.rank}>{index + 1}</span>
                <span><strong>{location.name}</strong><small>{location.project} · {location.owner ?? "PIC belum ada"}</small></span>
                <span><strong>{formatPct(location.reportedPct)}</strong><small>Dilaporkan</small></span>
                <span><strong>{formatPct(location.planPct)}</strong><small>Rencana</small></span>
                <span className={styles.negativeText}><strong>{formatPct(location.deviationPct)}</strong><small>Deviasi</small></span>
                <ChevronRight aria-hidden size={16} />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function oneDecimalLocal(value: number): number {
  return Math.round(value * 10) / 10;
}

function ActionCentre({
  onOpenDrawer,
  onOpenLocation,
}: {
  onOpenDrawer: (item: PrototypeException, trigger: HTMLElement) => void;
  onOpenLocation: (location: PrototypeLocation, next?: PrototypeView) => void;
}) {
  const [category, setCategory] = useState("Semua kategori");
  const [severity, setSeverity] = useState("Semua severity");
  const [ownership, setOwnership] = useState("Semua item");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => PROTOTYPE_EXCEPTIONS.filter((item) => {
    if (category !== "Semua kategori" && item.category !== category) return false;
    if (severity !== "Semua severity" && item.severity !== severity) return false;
    if (ownership === "Milik saya" && item.owner !== "Hery Dermanto") return false;
    if (ownership === "Lewat batas" && !item.due.toLowerCase().includes("lewat")) return false;
    if (query && ![item.title, item.locationName, item.project, item.owner ?? ""].join(" ").toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [category, ownership, query, severity]);

  const clear = () => {
    setCategory("Semua kategori");
    setSeverity("Semua severity");
    setOwnership("Semua item");
    setQuery("");
  };

  return (
    <div data-testid="action-centre">
      <PageIntro
        eyebrow="Ringkasan · antrean lintas proyek"
        title="Perlu tindakan"
        description="Keputusan, approval, laporan, jadwal, biaya, dan dokumen dalam satu antrean berbasis urgensi."
        actions={<PrimaryButton><ClipboardCheck aria-hidden size={16} /> Tampilkan milik saya</PrimaryButton>}
      />

      <section className={styles.actionSummary}>
        {[
          ["Kritis", PROTOTYPE_EXCEPTIONS.filter((item) => item.severity === "kritis").length, styles.severity_kritis],
          ["Lewat batas", PROTOTYPE_EXCEPTIONS.filter((item) => item.due.includes("Lewat")).length, styles.metricDanger],
          ["Belum ditangani", PROTOTYPE_EXCEPTIONS.filter((item) => !item.proposedSolution).length, styles.metricWarning],
          ["Menunggu approval", PROTOTYPE_EXCEPTIONS.filter((item) => item.category === "Approval").length, styles.metricAction],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className={cx(styles.actionSummaryItem, String(tone))}>
            <strong>{String(value)}</strong><span>{String(label)}</span>
          </div>
        ))}
      </section>

      <section className={styles.filterBar}>
        <label className={styles.searchControl}>
          <Search aria-hidden size={16} />
          <span className={styles.srOnly}>Cari tindakan</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari konteks atau lokasi…" />
        </label>
        <label><span className={styles.srOnly}>Kategori</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>Semua kategori</option>{["Keselamatan", "Jadwal", "Blocker", "Laporan", "Approval", "Biaya", "Dokumen"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span className={styles.srOnly}>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option>Semua severity</option><option value="kritis">Kritis</option><option value="tinggi">Tinggi</option><option value="sedang">Sedang</option><option value="rendah">Rendah</option></select></label>
        <label><span className={styles.srOnly}>Kepemilikan</span><select value={ownership} onChange={(event) => setOwnership(event.target.value)}><option>Semua item</option><option>Milik saya</option><option>Lewat batas</option></select></label>
        {(query || category !== "Semua kategori" || severity !== "Semua severity" || ownership !== "Semua item") ? <button type="button" className={styles.clearButton} onClick={clear}><X aria-hidden size={15} /> Bersihkan</button> : null}
      </section>

      <div className={styles.actionLayout}>
        <section className={cx(styles.panel, styles.actionQueue)}>
          <SectionHeading title={`${filtered.length} item membutuhkan tindakan`} description="Klik item untuk konteks dan solusi yang diusulkan" />
          {filtered.length === 0 ? <StatePanel state="empty" onRetry={clear} /> : (
            <div className={styles.exceptionList}>
              {filtered.map((item) => <ExceptionItem key={item.id} item={item} onOpen={onOpenDrawer} />)}
            </div>
          )}
        </section>
        <aside className={styles.actionGuide}>
          <p className={styles.eyebrow}>Cara membaca antrean</p>
          <h2>Urgensi lebih dulu, bukan alfabet</h2>
          <ol>
            <li><span>1</span><div><strong>Keselamatan</strong><small>Hentikan risiko dan putuskan mitigasi.</small></div></li>
            <li><span>2</span><div><strong>Jadwal & blocker</strong><small>Lindungi jalur kritis pekerjaan.</small></div></li>
            <li><span>3</span><div><strong>Submission & approval</strong><small>Jaga data dan keputusan tetap mengalir.</small></div></li>
            <li><span>4</span><div><strong>Biaya & dokumen</strong><small>Tutup risiko komersial dan kepatuhan.</small></div></li>
          </ol>
          <button type="button" onClick={() => onOpenLocation(PROTOTYPE_LOCATIONS[2])}>
            Contoh workspace lokasi <ArrowRight aria-hidden size={15} />
          </button>
        </aside>
      </div>
    </div>
  );
}

function AiPortfolioPulse({
  onOpenLocation,
}: {
  onOpenLocation: (location: PrototypeLocation, next?: PrototypeView) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answerVisible, setAnswerVisible] = useState(false);
  const top = [...PROTOTYPE_LOCATIONS].sort((a, b) => a.deviationPct - b.deviationPct).slice(0, 3);

  const ask = (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim()) return;
    setAnswerVisible(true);
  };

  return (
    <div data-testid="ai-pulse">
      <PageIntro
        eyebrow="AI Hub · Portfolio Pulse"
        title="AI menjelaskan konteks, bukan menciptakan angka"
        description={`Scope: semua proyek · periode 22–28 Juli 2026 · data s.d. ${PROTOTYPE_DATA_AS_OF}`}
        actions={<StatusBadge label="Readiness 86/100 · Layak dianalisis" tone={styles.tone_terkendali} icon={CheckCircle2} />}
      />

      <nav className={styles.aiNav} aria-label="Bagian AI Hub">
        {["Portfolio Pulse", "Perlu Tindakan", "Report Studio", "Ask MARLIN", "Riwayat & Audit"].map((item, index) => (
          <button type="button" className={index === 0 ? styles.aiNavActive : undefined} key={item}>{item}</button>
        ))}
      </nav>

      <div className={styles.aiGrid}>
        <section className={cx(styles.panel, styles.aiBrief)}>
          <div className={styles.aiBriefHeader}>
            <span><Bot aria-hidden size={21} /></span>
            <div><p className={styles.eyebrow}>Ringkasan ter-grounding</p><h2>Tiga perhatian utama portfolio</h2></div>
            <StatusBadge label="Mock AI" tone={styles.statusNeutral} />
          </div>
          <ol>
            <li>
              <span>1</span>
              <div>
                <strong>Deviasi terkonsentrasi pada pekerjaan revetment dan struktur TPI</strong>
                <p>{top.length} lokasi menyumbang risiko jadwal terbesar. Penyebab dominan adalah akses material, persetujuan metode, dan ketersediaan alat.</p>
                <button type="button" onClick={() => onOpenLocation(top[0])}>Buka sumber lokasi <ArrowRight aria-hidden size={14} /></button>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>{PROTOTYPE_SUMMARY.missing} lokasi belum mengirim laporan hari ini</strong>
                <p>Mayoritas berada pada tiga provinsi; empat PIC belum mempunyai update dalam lebih dari satu hari.</p>
                <button type="button">Lihat submission monitor <ArrowRight aria-hidden size={14} /></button>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Solusi tim tersedia pada 71% kendala prioritas</strong>
                <p>Item tanpa solusi sebaiknya dieskalasi sebelum rapat portfolio pukul 14.00 WIB.</p>
                <button type="button">Buka Action Centre <ArrowRight aria-hidden size={14} /></button>
              </div>
            </li>
          </ol>
          <div className={styles.aiSources}>
            <p><FileCheck2 aria-hidden size={15} /> Sumber yang digunakan</p>
            <div>
              <button type="button">120 status lokasi</button>
              <button type="button">92 laporan counted</button>
              <button type="button">48 exception</button>
              <button type="button">28 bukti foto</button>
            </div>
          </div>
        </section>

        <section className={cx(styles.panel, styles.askPanel)}>
          <SectionHeading title="Ask MARLIN" description="Pertanyaan read-only dengan sumber dan scope" />
          <div className={styles.suggestedQuestions}>
            {["Lokasi mana yang perlu keputusan hari ini?", "Apa penyebab deviasi terbesar?", "Siapa PIC yang belum mengirim laporan?"].map((item) => (
              <button type="button" key={item} onClick={() => setQuestion(item)}>{item}</button>
            ))}
          </div>
          <form onSubmit={ask} className={styles.askForm}>
            <label>
              <span className={styles.srOnly}>Pertanyaan untuk Ask MARLIN</span>
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder="Tanyakan kondisi portfolio…" />
            </label>
            <PrimaryButton type="submit" disabled={!question.trim()}><Sparkles aria-hidden size={16} /> Analisis sumber</PrimaryButton>
          </form>
          {answerVisible ? (
            <div className={styles.aiAnswer} aria-live="polite">
              <div><Bot aria-hidden size={18} /><strong>Jawaban mock · scope portfolio nasional</strong></div>
              <p>
                Prioritaskan {top[0].name}, {top[1].name}, dan {top[2].name}. Ketiganya mempunyai deviasi Dilaporkan di bawah −15 poin atau blocker kritis yang belum ditutup.
              </p>
              <footer>
                <span>Periode 22–28 Juli 2026</span>
                <button type="button" onClick={() => onOpenLocation(top[0])}>3 sumber <ChevronRight aria-hidden size={14} /></button>
              </footer>
            </div>
          ) : null}
        </section>

        <aside className={styles.aiTrustPanel}>
          <p className={styles.eyebrow}>Kontrak kepercayaan</p>
          <h2>Setiap jawaban harus dapat dibuktikan</h2>
          <ul>
            <li><Check aria-hidden size={15} /> Scope dan periode terlihat</li>
            <li><Check aria-hidden size={15} /> Angka berasal dari calculation layer</li>
            <li><Check aria-hidden size={15} /> Status data dan readiness eksplisit</li>
            <li><Check aria-hidden size={15} /> Sumber dapat di-drill-down</li>
            <li><Check aria-hidden size={15} /> Keterbatasan tidak disembunyikan</li>
          </ul>
          <p>Prototype ini memakai output mock deterministik dan tidak memanggil provider AI.</p>
        </aside>
      </div>
    </div>
  );
}
