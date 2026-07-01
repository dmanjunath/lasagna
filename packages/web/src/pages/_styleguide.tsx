import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Bell,
  Download,
  Inbox,
  Layers,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wallet,
} from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  CardHeader,
  CellStack,
  Delta,
  EmptyState,
  Eyebrow,
  Field,
  Input,
  Label,
  Modal,
  PageHeader,
  Section,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonText,
  Stat,
  Surface,
  Table,
  Textarea,
  TBody,
  TD,
  TH,
  THead,
  ThemeToggle,
  Tooltip,
  TooltipProvider,
  ToastProvider,
  TR,
  useToast,
  useUiMode,
} from '../components/uikit';
import { cn, formatMoney } from '../lib/utils';

/* ── Small helpers used only by the styleguide ─────────────────────────────── */

function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m) return rgb;
  const [r, g, b, a] = m.map(Number);
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
  if (a !== undefined && a < 1) return `${hex(r)}${hex(g)}${hex(b)} · ${Math.round(a * 100)}%`;
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** A color chip that reads its own live computed value so the hex tracks the
 *  current mode. `swatchClass` paints the sample; `cssColor` resolves the hex. */
function Swatch({
  name,
  token,
  swatchClass,
  cssColor,
  border,
}: {
  name: string;
  token: string;
  swatchClass?: string;
  cssColor?: string;
  border?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { mode } = useUiMode();
  const [hex, setHex] = useState('');
  useEffect(() => {
    if (ref.current) setHex(rgbToHex(getComputedStyle(ref.current).backgroundColor));
  }, [mode]);
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={ref}
        className={cn(
          'h-16 w-full rounded-ui-md',
          border && 'border border-line',
          swatchClass,
        )}
        style={cssColor ? { backgroundColor: cssColor } : undefined}
      />
      <div className="leading-tight">
        <div className="text-[13px] font-medium text-content">{name}</div>
        <div className="ui-tnum text-[11px] text-content-muted">{token}</div>
        <div className="ui-tnum text-[11px] text-content-faint">{hex}</div>
      </div>
    </div>
  );
}

function Block({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-content-secondary">
          {title}
        </h3>
        {note && <span className="text-[12px] text-content-muted">{note}</span>}
      </div>
      {children}
    </div>
  );
}

/* ── Sections ──────────────────────────────────────────────────────────────── */

function Colors() {
  return (
    <Section title="Color" description="Quiet warm neutrals, one terracotta accent, warm-leaning semantics. Every token has a light and dark value.">
      <div className="space-y-8">
        <Block title="Surfaces & elevation">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Swatch name="Canvas" token="bg-canvas" swatchClass="bg-canvas" border />
            <Swatch name="Canvas sunken" token="bg-canvas-sunken" swatchClass="bg-canvas-sunken" border />
            <Swatch name="Panel" token="bg-panel" swatchClass="bg-panel" border />
            <Swatch name="Panel raised" token="bg-panel-raised" swatchClass="bg-panel-raised" border />
            <Swatch name="Hairline" token="border-line" cssColor="var(--ui-hairline)" border />
            <Swatch name="Line strong" token="border-line-strong" cssColor="var(--ui-line)" border />
          </div>
        </Block>

        <Block title="Text hierarchy">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Swatch name="Content" token="text-content" swatchClass="bg-content" />
            <Swatch name="Secondary" token="text-content-secondary" swatchClass="bg-content-secondary" />
            <Swatch name="Muted" token="text-content-muted" swatchClass="bg-content-muted" />
            <Swatch name="Faint" token="text-content-faint" swatchClass="bg-content-faint" />
          </div>
        </Block>

        <Block title="Brand & semantic" note="used sparingly, never color-only">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Swatch name="Brand" token="bg-brand" swatchClass="bg-brand" />
            <Swatch name="Brand hover" token="bg-brand-hover" swatchClass="bg-brand-hover" />
            <Swatch name="Positive" token="text-positive" swatchClass="bg-positive" />
            <Swatch name="Negative" token="text-negative" swatchClass="bg-negative" />
            <Swatch name="Caution" token="text-caution" swatchClass="bg-caution" />
            <Swatch name="Info" token="text-info" swatchClass="bg-info" />
          </div>
        </Block>

        <Block title="Data-viz palette" note="cash · investments · property · debt · other (+2)">
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ['Cash', '--ui-viz-1'],
              ['Investments', '--ui-viz-2'],
              ['Property', '--ui-viz-3'],
              ['Debt', '--ui-viz-4'],
              ['Other', '--ui-viz-5'],
              ['Extra', '--ui-viz-6'],
              ['Extra', '--ui-viz-7'],
            ].map(([label, v], i) => (
              <Swatch key={i} name={label} token={`viz-${i + 1}`} cssColor={`var(${v})`} />
            ))}
          </div>
        </Block>
      </div>
    </Section>
  );
}

function Typography() {
  return (
    <Section title="Typography" description="Fraunces (warm humanist serif) for editorial display; Geist for UI & body; tabular lining numerals for money.">
      <Surface pad="lg" className="space-y-6">
        <div className="space-y-1">
          <Eyebrow>Display · Fraunces</Eyebrow>
          <p className="font-editorial text-[44px] font-medium leading-[1.02] tracking-[-0.01em] text-content">
            Calm, warm, effortless.
          </p>
        </div>
        <div className="grid gap-5 border-t border-line pt-6 sm:grid-cols-2">
          <div>
            <h1 className="font-editorial text-[30px] font-medium leading-tight text-content">Page title — 30/38</h1>
            <h2 className="mt-3 text-[18px] font-semibold text-content">Section heading — 18 semibold</h2>
            <h3 className="mt-3 text-[15px] font-semibold text-content">Card heading — 15 semibold</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-content-secondary">
              Body copy at 15px with relaxed line-height for comfortable reading. Friendly,
              plain language — never assume financial fluency.
            </p>
            <p className="mt-2 text-[13px] text-content-muted">Caption / metadata — 13px muted.</p>
          </div>
          <div className="space-y-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-muted">Hero number · tabular</div>
              <div className="ui-tnum text-[52px] font-semibold leading-none tracking-tight text-content">
                {formatMoney(1284530.5, true)}
              </div>
            </div>
            <div className="ui-tnum grid grid-cols-2 gap-x-8 gap-y-1 text-[15px] text-content-secondary">
              <span>1,204.00</span><span className="text-right">8,330.25</span>
              <span>97,418.10</span><span className="text-right">240,991.00</span>
            </div>
            <p className="text-[12px] text-content-muted">Digits share one width, so columns never jump.</p>
          </div>
        </div>
      </Surface>
    </Section>
  );
}

function SpacingRadiusShadow() {
  const space = [
    ['1', '4px'], ['2', '8px'], ['3', '12px'], ['4', '16px'], ['6', '24px'], ['8', '32px'], ['12', '48px'],
  ];
  const radii = [
    ['xs', 'rounded-ui-xs'], ['sm', 'rounded-ui-sm'], ['md', 'rounded-ui-md'], ['lg', 'rounded-ui-lg'], ['xl', 'rounded-ui-xl'],
  ];
  const shadows = [
    ['sm', 'shadow-ui-sm'], ['md', 'shadow-ui-md'], ['lg', 'shadow-ui-lg'], ['xl', 'shadow-ui-xl'],
  ];
  return (
    <Section title="Spacing · Radius · Elevation" description="A consistent 4px-based rhythm, a friendly rounded-corner scale, and soft warm-tinted shadows.">
      <div className="grid gap-6 lg:grid-cols-3">
        <Surface pad="lg">
          <Block title="Spacing">
            <div className="space-y-2.5">
              {space.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="ui-tnum w-14 shrink-0 text-[12px] text-content-muted">{v}</span>
                  <div className="h-3 rounded-sm bg-brand-soft" style={{ width: v }} />
                  <span className="text-[12px] text-content-faint">space-{k}</span>
                </div>
              ))}
            </div>
          </Block>
        </Surface>
        <Surface pad="lg">
          <Block title="Radius">
            <div className="flex flex-wrap gap-4">
              {radii.map(([k, cls]) => (
                <div key={k} className="flex flex-col items-center gap-2">
                  <div className={cn('h-16 w-16 border border-line bg-brand-soft', cls)} />
                  <span className="text-[12px] text-content-muted">{k}</span>
                </div>
              ))}
            </div>
          </Block>
        </Surface>
        <Surface pad="lg">
          <Block title="Elevation">
            <div className="grid grid-cols-2 gap-4">
              {shadows.map(([k, cls]) => (
                <div key={k} className="flex flex-col items-center gap-2">
                  <div className={cn('h-16 w-full rounded-ui-md border border-line bg-panel', cls)} />
                  <span className="text-[12px] text-content-muted">{k}</span>
                </div>
              ))}
            </div>
          </Block>
        </Surface>
      </div>
    </Section>
  );
}

function Buttons() {
  return (
    <Section title="Buttons" description="Primary / secondary / ghost / destructive · sizes · loading & disabled. 44px touch targets at md+.">
      <Surface pad="lg" className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive" leadingIcon={<Trash2 className="h-4 w-4" />}>Delete</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg" trailingIcon={<ArrowRight className="h-4 w-4" />}>Large</Button>
          <Button size="icon" variant="secondary" aria-label="Add"><Plus className="h-5 w-5" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button loading>Saving…</Button>
          <Button disabled>Disabled</Button>
          <Button variant="secondary" disabled>Disabled</Button>
          <Button variant="primary" leadingIcon={<Sparkles className="h-4 w-4" />}>With icon</Button>
        </div>
      </Surface>
    </Section>
  );
}

function FormsRow() {
  const [invalid, setInvalid] = useState('not-an-email');
  return (
    <Section title="Inputs, fields & selects" description="Labelled fields with hint and error states; native select styled to match.">
      <Surface pad="lg" className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" hint="As it appears on your statements.">
          <Input placeholder="Ada Lovelace" />
        </Field>
        <Field label="Search">
          <Input leadingIcon={<Search className="h-4 w-4" />} placeholder="Search accounts" />
        </Field>
        <Field label="Email" error={invalid.includes('@') ? undefined : 'Enter a valid email address.'}>
          <Input value={invalid} invalid={!invalid.includes('@')} onChange={(e) => setInvalid(e.target.value)} />
        </Field>
        <Field label="Account type" required hint="Pick the closest match.">
          <Select defaultValue="checking">
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
            <option value="brokerage">Brokerage</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note">
            <Textarea placeholder="Optional note…" />
          </Field>
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <Label>Disabled</Label>
          <Input disabled placeholder="Unavailable" className="max-w-xs" />
        </div>
      </Surface>
    </Section>
  );
}

function BadgesStats() {
  return (
    <Section title="Badges & KPIs" description="Status pills (each pairs tint + text/dot) and money KPIs with up/down deltas.">
      <div className="space-y-5">
        <Surface pad="lg" className="flex flex-wrap gap-2.5">
          <Badge tone="neutral" dot>Neutral</Badge>
          <Badge tone="brand">Brand</Badge>
          <Badge tone="positive" dot>On track</Badge>
          <Badge tone="negative" dot>Over budget</Badge>
          <Badge tone="caution" dot>Review</Badge>
          <Badge tone="info" dot>Syncing</Badge>
        </Surface>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Surface pad="md"><Stat label="Net worth" value={formatMoney(1284530, true)} delta="+4.2%" deltaDirection="up" caption="vs. last month" icon={<Wallet className="h-4 w-4" />} /></Surface>
          <Surface pad="md"><Stat label="Cash" value={formatMoney(42180, true)} delta="+1.1%" deltaDirection="up" caption="across 3 accounts" /></Surface>
          <Surface pad="md"><Stat label="Spending" value={formatMoney(6240, true)} delta="-8.0%" deltaDirection="down" caption="this month" /></Surface>
          <Surface pad="md"><Stat label="Debt" value={formatMoney(18900, true)} delta="0.0%" deltaDirection="flat" caption="no change" /></Surface>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Delta value="+$1,204" direction="up" />
          <Delta value="-$320" direction="down" />
          <Delta value="$0" direction="flat" />
        </div>
      </div>
    </Section>
  );
}

function SegmentsTable() {
  const [range, setRange] = useState('3m');
  const rows = [
    ['Chase Checking', 'Cash', 12480.5, 'up'],
    ['Vanguard Brokerage', 'Investments', 304991.0, 'up'],
    ['Home', 'Property', 720000.0, 'flat'],
    ['Student Loan', 'Debt', -18900.25, 'down'],
  ] as const;
  return (
    <Section
      title="Segmented control & table"
      description="A quiet, airy data table with a range toggle. Money right-aligned and tabular."
      action={
        <SegmentedControl
          aria-label="Range"
          value={range}
          onChange={setRange}
          options={[
            { value: '1m', label: '1M' },
            { value: '3m', label: '3M' },
            { value: '1y', label: '1Y' },
            { value: 'all', label: 'All' },
          ]}
        />
      }
    >
      <Surface pad="none" className="overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>Account</TH>
              <TH>Category</TH>
              <TH numeric>Balance</TH>
              <TH numeric>Trend</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map(([name, cat, bal, dir]) => (
              <TR key={name} interactive>
                <TD><CellStack primary={name} secondary="••4821" /></TD>
                <TD><Badge tone="neutral" dot>{cat}</Badge></TD>
                <TD numeric className={bal < 0 ? 'text-negative' : undefined}>{formatMoney(bal, true)}</TD>
                <TD numeric>
                  <Delta value={dir === 'flat' ? '0%' : dir === 'up' ? '+2.4%' : '-1.2%'} direction={dir} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Surface>
    </Section>
  );
}

function Feedback() {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  return (
    <Section title="Feedback — alerts, toasts, tooltip, modal & sheet" description="Calm, reassuring messaging. Icons back every color.">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Alert tone="info" title="Heads up">Your December statement is ready to review.</Alert>
          <Alert tone="positive" title="All set">Your accounts synced successfully a moment ago.</Alert>
          <Alert tone="caution" title="Action needed">One connection needs to be re-authenticated.</Alert>
          <Alert tone="negative" title="Couldn't sync">We'll retry automatically in a few minutes.</Alert>
        </div>
        <Surface pad="lg" className="space-y-4">
          <CardHeader title="Interactive" description="Trigger the overlays and notifications." />
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setModal(true)}>Open modal</Button>
            <Button variant="secondary" onClick={() => setSheet(true)}>Open sheet</Button>
            <Button variant="ghost" leadingIcon={<Bell className="h-4 w-4" />} onClick={() => toast({ tone: 'positive', title: 'Saved', description: 'Your changes are safe.' })}>
              Toast
            </Button>
            <Tooltip content="A gentle hint appears here">
              <Button variant="ghost">Hover for tooltip</Button>
            </Tooltip>
          </div>
        </Surface>
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Rename account"
        description="Give this account a name you'll recognize."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={() => setModal(false)}>Save changes</Button>
          </>
        }
      >
        <Field label="Account name">
          <Input defaultValue="Everyday Checking" />
        </Field>
      </Modal>

      <Modal
        open={sheet}
        onClose={() => setSheet(false)}
        variant="sheet"
        title="Add an account"
        description="Connect a bank or add one manually."
        footer={<Button className="w-full" onClick={() => setSheet(false)}>Continue</Button>}
      >
        <div className="space-y-4">
          <Field label="Institution"><Input leadingIcon={<Search className="h-4 w-4" />} placeholder="Search 12,000+ banks" /></Field>
          <Field label="Account type">
            <Select defaultValue="checking">
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </Section>
  );
}

function EmptyAndLoading() {
  return (
    <Section title="Empty & loading states" description="Reassuring placeholders and a calm shimmer while data loads.">
      <div className="grid gap-4 lg:grid-cols-2">
        <EmptyState
          icon={<Inbox className="h-6 w-6" />}
          title="No transactions yet"
          description="Once you connect an account, your activity will show up here automatically."
          action={<Button leadingIcon={<Plus className="h-4 w-4" />}>Connect an account</Button>}
        />
        <Surface pad="lg" className="space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-full" />
            <div className="flex-1"><SkeletonText lines={2} /></div>
          </div>
          <Skeleton className="h-28 w-full rounded-ui-md" />
          <div className="flex gap-3">
            <Skeleton className="h-9 w-24 rounded-ui-md" />
            <Skeleton className="h-9 w-24 rounded-ui-md" />
          </div>
        </Surface>
      </div>
    </Section>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

function StyleguideBody() {
  return (
    <div className="ui-root min-h-screen">
      <header className="sticky top-0 z-50 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-ui-sm bg-brand text-brand-fg">
              <Layers className="h-4 w-4" />
            </span>
            <div className="leading-tight">
              <div className="font-editorial text-[18px] font-semibold text-content">LasagnaFi</div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-content-muted">Design System</div>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-16 px-5 py-12 sm:px-8 sm:py-16">
        <PageHeader
          eyebrow={<Eyebrow>v3 · warm · calm · airy</Eyebrow>}
          title="A calm, warm language for money."
          lede="One terracotta accent, paper-warm neutrals, a first-class warm dark mode, and tabular numerals everywhere money lives. This page is the living source of truth — flip the mode in the corner to review both."
          actions={<Button leadingIcon={<Download className="h-4 w-4" />} variant="secondary">Export tokens</Button>}
        />
        <Colors />
        <Typography />
        <SpacingRadiusShadow />
        <Buttons />
        <FormsRow />
        <BadgesStats />
        <SegmentsTable />
        <Feedback />
        <EmptyAndLoading />

        <footer className="border-t border-line pt-8 text-center text-[12px] text-content-muted">
          LasagnaFi Design System v3 · {new Date().getFullYear()} · built as running code
        </footer>
      </main>
    </div>
  );
}

export function Styleguide() {
  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        <StyleguideBody />
      </ToastProvider>
    </TooltipProvider>
  );
}

export default Styleguide;
