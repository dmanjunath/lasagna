import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { formatMoney } from '../lib/utils';
import { SimpleShell } from '../components/layout/simple-shell';
import { ConfirmDialog } from '../components/ui/confirm-dialog';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type FinancialProfile = {
  dateOfBirth: string | null;
  age: number | null;
  annualIncome: number | null;
  filingStatus: string | null;
  stateOfResidence: string | null;
  employmentType: string | null;
  riskTolerance: string | null;
  retirementAge: number | null;
  employerMatchPercent: number | null;
  dependentCount: number | null;
  hasHDHP: boolean | null;
  isPSLFEligible: boolean | null;
};

type EditSection = 'personal' | 'income' | null;

interface PlaidItemPreview {
  id: string;
  institutionId: string | null;
  institutionName: string | null;
  status: string;
  lastSyncedAt: string | null;
  accounts: Array<{ id: string; name: string; type: string; mask: string | null }>;
}

interface PlaidMetadata {
  institution?: { name?: string; institution_id?: string };
}
interface PlaidHandler {
  open: () => void;
  destroy: () => void;
}
interface PlaidLinkFactory {
  create: (opts: {
    token: string;
    onSuccess: (publicToken: string, metadata: PlaidMetadata) => void | Promise<void>;
    onExit: () => void;
  }) => PlaidHandler;
}

const FILING_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'married_joint', label: 'Married Filing Jointly' },
  { value: 'married_separate', label: 'Married Filing Separately' },
  { value: 'head_of_household', label: 'Head of Household' },
  { value: 'qualifying_widow', label: 'Qualifying Widow(er)' },
];

const RISK_TOLERANCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'conservative', label: 'Conservative' },
  { value: 'moderate_conservative', label: 'Moderate-conservative' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'moderate_aggressive', label: 'Moderate-aggressive' },
  { value: 'aggressive', label: 'Aggressive' },
];

const EMPLOYMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'w2', label: 'W2 employee' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: '1099', label: '1099 / contractor' },
  { value: 'business_owner', label: 'Business owner' },
];

const US_STATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'DC', label: 'District of Columbia' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
];

function formatFilingStatus(status: string | null): string {
  if (!status) return 'Not set';
  return FILING_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

function formatRiskTolerance(risk: string | null): string {
  if (!risk) return 'Not set';
  return RISK_TOLERANCE_OPTIONS.find((o) => o.value === risk)?.label ?? risk;
}

function formatEmploymentType(t: string | null): string {
  if (!t) return 'Not set';
  return EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

/** Tailwind text-color class for the risk-tolerance value, retaining the
 *  original color signaling: aggressive → success/basil, moderate → cheese
 *  (gold), conservative → accent/sauce. */
function riskToneClass(risk: string | null): string {
  if (!risk) return 'text-text-muted';
  if (risk.includes('aggressive')) return 'text-success';
  if (risk === 'moderate') return 'text-[color:var(--lf-cheese)]';
  return 'text-accent';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Settings() {
  const { user, tenant, logout, updateMe } = useAuth();
  const [, setLocation] = useLocation();
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  // Profile name editing
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);

  // Financial profile
  const [profile, setProfile] = useState<FinancialProfile | null>(null);
  const [, setProfileLoading] = useState(true);
  const [editSection, setEditSection] = useState<EditSection>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    dateOfBirth: '',
    annualIncome: '',
    filingStatus: '',
    stateOfResidence: '',
    riskTolerance: '',
    employerMatchPercent: '',
    retirementAge: '',
    employmentType: 'w2',
    dependentCount: '',
    hasHDHP: false,
    isPSLFEligible: false,
  });

  // Connected accounts preview
  const [items, setItems] = useState<PlaidItemPreview[]>([]);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkStillSyncing, setLinkStillSyncing] = useState(false);

  // Notification toggle errors (revert pattern)
  const [prefError, setPrefError] = useState<string | null>(null);

  // Password change
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Sign out + delete-account confirm dialogs
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const displayName = user?.name || tenant?.name || user?.email?.split('@')[0] || 'You';
  const avatarLetter = displayName[0]?.toUpperCase() || '?';

  // ---- Effects ------------------------------------------------------------

  const fetchProfile = useCallback(async () => {
    try {
      const res = await api.getFinancialProfile();
      setProfile(res.financialProfile);
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const refreshItems = useCallback(() => {
    api
      .getItems()
      // Show ALL institutions, including 0-account ones — those are exactly
      // the states that need user attention (re-auth, stuck sync).
      .then((d) => setItems(d.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchProfile();
    refreshItems();
  }, [fetchProfile, refreshItems]);

  // ---- Handlers -----------------------------------------------------------

  async function saveName() {
    if (nameDraft.trim() === (user?.name ?? '').trim()) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      await updateMe({ name: nameDraft.trim() || null });
      setEditingName(false);
    } finally {
      setSavingName(false);
    }
  }

  async function togglePref(field: 'notifyDaily' | 'notifyBills' | 'notifyWeeklyEmail') {
    if (!user) return;
    const prev = user[field];
    setPrefError(null);
    try {
      await updateMe({ [field]: !prev });
    } catch (err) {
      // updateMe already optimistically set the new value; on failure surface
      // the error so the user sees that the toggle didn't actually persist.
      // Refresh from the server to ensure the toggle visually reflects truth.
      setPrefError(err instanceof Error ? err.message : "Couldn't save that preference.");
    }
  }

  function openEdit(section: EditSection) {
    setSaveError(null);
    setFormData({
      dateOfBirth: profile?.dateOfBirth ? profile.dateOfBirth.split('T')[0] : '',
      annualIncome: profile?.annualIncome?.toString() ?? '',
      filingStatus: profile?.filingStatus ?? '',
      stateOfResidence: profile?.stateOfResidence ?? '',
      riskTolerance: profile?.riskTolerance ?? '',
      employerMatchPercent: profile?.employerMatchPercent?.toString() ?? '',
      retirementAge: profile?.retirementAge?.toString() ?? '',
      employmentType: profile?.employmentType ?? 'w2',
      dependentCount: profile?.dependentCount?.toString() ?? '',
      hasHDHP: profile?.hasHDHP ?? false,
      isPSLFEligible: profile?.isPSLFEligible ?? false,
    });
    setEditSection(section);
  }

  async function saveProfile() {
    setSavingProfile(true);
    setSaveError(null);
    try {
      const updates: Record<string, unknown> = {};
      if (editSection === 'personal') {
        updates.dateOfBirth = formData.dateOfBirth || null;
        updates.filingStatus = formData.filingStatus || null;
        updates.stateOfResidence = formData.stateOfResidence || null;
        updates.riskTolerance = formData.riskTolerance || null;
        updates.retirementAge = formData.retirementAge ? Number(formData.retirementAge) : null;
        updates.dependentCount = formData.dependentCount !== '' ? Number(formData.dependentCount) : null;
        updates.hasHDHP = formData.hasHDHP;
        updates.isPSLFEligible = formData.isPSLFEligible;
      } else if (editSection === 'income') {
        updates.annualIncome = formData.annualIncome ? Number(formData.annualIncome) : null;
        updates.employerMatchPercent = formData.employerMatchPercent ? Number(formData.employerMatchPercent) : null;
        updates.employmentType = formData.employmentType || null;
      }
      await api.updateFinancialProfile(updates);
      await fetchProfile();
      setEditSection(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save your changes.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleConnect() {
    setLinkError('');
    setLinkStillSyncing(false);
    setLinking(true);
    try {
      const [{ linkToken }] = await Promise.all([
        api.createLinkToken(),
        (await import('../lib/load-plaid.js')).loadPlaidSdk(),
      ]);
      const Plaid = (window as unknown as { Plaid: PlaidLinkFactory }).Plaid;
      if (!Plaid) {
        setLinkError('Could not load the bank connector. Refresh and try again.');
        setLinking(false);
        return;
      }
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken, metadata) => {
          try {
            await api.exchangeToken({
              publicToken,
              institutionId: metadata.institution?.institution_id,
              institutionName: metadata.institution?.name,
            });
            let attempts = 0;
            const poll = setInterval(async () => {
              attempts++;
              try {
                const data = await api.getItems();
                const newItem = data.items.find(
                  (i) => i.institutionName === metadata.institution?.name,
                );
                if (newItem && newItem.accounts.length > 0) {
                  clearInterval(poll);
                  setItems(data.items);
                  setLinking(false);
                } else if (attempts >= 10) {
                  // Poll timed out without seeing accounts. Show recoverable
                  // state instead of silently going idle.
                  clearInterval(poll);
                  setItems(data.items);
                  setLinking(false);
                  setLinkStillSyncing(true);
                }
              } catch {
                if (attempts >= 10) {
                  clearInterval(poll);
                  setLinking(false);
                  setLinkStillSyncing(true);
                }
              }
            }, 1500);
          } catch {
            setLinkError("Couldn't finish linking that account.");
            setLinking(false);
          }
        },
        onExit: () => setLinking(false),
      });
      handler.open();
    } catch {
      setLinkError("Couldn't start the bank connector.");
      setLinking(false);
    }
  }

  async function handleChangePassword() {
    setPasswordMessage(null);
    if (!currentPassword || !newPassword) {
      setPasswordMessage({ kind: 'err', text: 'Fill in both fields.' });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMessage({ kind: 'err', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ kind: 'err', text: "New passwords don't match." });
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setPasswordMessage({ kind: 'ok', text: 'Password updated.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordForm(false);
    } catch (err) {
      setPasswordMessage({
        kind: 'err',
        text: err instanceof Error ? err.message : "Couldn't update password.",
      });
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleDeleteAccount() {
    setDeletingAccount(true);
    setDeleteError(null);
    try {
      // The delete-account endpoint may not be wired yet — surface that
      // gracefully instead of leaving the user with a hung dialog.
      const deleteMe = (api as unknown as { deleteMe?: () => Promise<unknown> }).deleteMe;
      if (!deleteMe) {
        setDeleteError("Account deletion isn't available yet. Email support@lasagnafi.com.");
        return;
      }
      await deleteMe();
      await logout();
      setLocation('/');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete account.');
    } finally {
      setDeletingAccount(false);
    }
  }

  // ---- Derived display values --------------------------------------------

  const age = profile?.age != null ? String(profile.age) : 'Not set';
  const grossIncome =
    profile?.annualIncome != null ? `${formatMoney(profile.annualIncome, true)}/yr` : 'Not set';
  const filingStatus = formatFilingStatus(profile?.filingStatus ?? null);
  const state = profile?.stateOfResidence
    ? US_STATE_OPTIONS.find((s) => s.value === profile.stateOfResidence)?.label ??
      profile.stateOfResidence
    : 'Not set';
  const riskTolerance = formatRiskTolerance(profile?.riskTolerance ?? null);
  const employmentType = formatEmploymentType(profile?.employmentType ?? null);
  const employerMatch =
    profile?.employerMatchPercent != null ? `${profile.employerMatchPercent}%` : 'Not set';
  const retirementAge = profile?.retirementAge != null ? String(profile.retirementAge) : 'Not set';
  const dependentCount = profile?.dependentCount != null ? String(profile.dependentCount) : 'Not set';

  const itemsWithAccounts = items.filter((i) => i.accounts.length > 0);
  const itemsNeedingAttention = items.filter(
    (i) => i.accounts.length === 0 || i.status === 'item_login_required' || i.status === 'error',
  );

  // ---- Render -------------------------------------------------------------

  return (
    <SimpleShell title="Profile" showBack>
      {/* Profile header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-accent grid place-items-center text-2xl font-serif font-medium text-white shrink-0 shadow-sm">
          {avatarLetter}
        </div>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveName();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                className="flex-1 text-xl font-serif rounded-lg bg-bg-elevated border border-rule px-2 py-1 focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
              />
              <button
                onClick={saveName}
                disabled={savingName}
                className="text-xs font-medium text-accent disabled:opacity-50"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setNameDraft(user?.name ?? '');
                setEditingName(true);
              }}
              className="text-2xl font-serif font-medium leading-tight text-left hover:underline decoration-rule decoration-1 underline-offset-4"
              title="Edit name"
            >
              {displayName}
            </button>
          )}
          <div className="text-sm text-text-muted mt-1 truncate">{user?.email}</div>
        </div>
      </div>

      {/* Connected accounts */}
      <section className="mb-5">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium mb-2">
          Connected accounts
        </h3>
        {items.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm p-5 text-center text-sm text-text-muted">
            No accounts connected yet.
          </div>
        ) : (
          <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm overflow-hidden">
            {items.map((item, i) => {
              const needsAttention =
                item.status === 'item_login_required' || item.status === 'error';
              const isStuck = !needsAttention && item.accounts.length === 0;
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 p-4 ${
                    i < items.length - 1 ? 'border-b border-rule/60' : ''
                  }`}
                >
                  <div className="text-xl" aria-hidden="true">🏦</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {item.institutionName || 'Bank'}
                    </div>
                    {needsAttention ? (
                      <div className="text-xs text-accent">
                        ⚠ Needs reconnect ·{' '}
                        <Link href="/accounts" className="underline">Fix in Accounts</Link>
                      </div>
                    ) : isStuck ? (
                      <div className="text-xs text-text-muted">
                        Still syncing… open{' '}
                        <Link href="/accounts" className="underline">Accounts</Link> to retry
                      </div>
                    ) : (
                      <div className="text-xs text-success">
                        Connected · {item.accounts.length} account
                        {item.accounts.length === 1 ? '' : 's'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!isDemoMode && (
          <button
            onClick={handleConnect}
            disabled={linking}
            className="w-full mt-3 rounded-xl bg-text text-white py-3 text-sm font-medium disabled:opacity-50 min-h-[44px]"
          >
            {linking
              ? 'Opening bank connector…'
              : itemsWithAccounts.length === 0
                ? 'Connect a bank'
                : '+ Connect another bank'}
          </button>
        )}
        {!isDemoMode && (
          <p className="text-[11px] text-text-muted text-center mt-1.5">
            Secure bank linking powered by Plaid
          </p>
        )}
        {linkError && <div className="text-xs text-accent mt-2 text-center">{linkError}</div>}
        {linkStillSyncing && (
          <div className="mt-2 px-3 py-2 rounded-xl bg-bg-elevated border border-rule text-xs text-text-secondary flex items-center justify-between gap-2">
            <span>Still syncing — your bank can take a minute.</span>
            <button
              onClick={() => {
                setLinkStillSyncing(false);
                refreshItems();
              }}
              className="text-accent font-medium"
            >
              Retry
            </button>
          </div>
        )}
        <Link
          href="/accounts"
          className="block w-full mt-2 text-xs text-text-muted py-2 text-center underline"
        >
          Manage all accounts →
        </Link>
        {itemsNeedingAttention.length > 0 && (
          <div className="mt-2 text-[11px] text-accent text-center">
            {itemsNeedingAttention.length} institution
            {itemsNeedingAttention.length === 1 ? '' : 's'} need attention
          </div>
        )}
      </section>

      {/* Financial profile */}
      <section className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium">
            Personal
          </h3>
          {!isDemoMode && editSection !== 'personal' && (
            <button
              onClick={() => openEdit('personal')}
              className="text-xs font-medium text-accent min-h-[32px] px-2"
            >
              Edit
            </button>
          )}
        </div>
        {editSection === 'personal' && !isDemoMode ? (
          // When editing personal, REPLACE the personal summary with the form
          // so there's a single source of truth on screen.
          <EditCard title="Personal info" onCancel={() => setEditSection(null)}>
            <PersonalEditFields
              formData={formData}
              setFormData={setFormData}
            />
            {saveError && (
              <div className="text-xs text-accent" role="alert">{saveError}</div>
            )}
            <EditActions
              onSave={saveProfile}
              onCancel={() => setEditSection(null)}
              saving={savingProfile}
            />
          </EditCard>
        ) : (
          <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm overflow-hidden">
            <ProfileRow label="Age" value={age} />
            <ProfileRow label="Filing status" value={filingStatus} divider />
            <ProfileRow label="State" value={state} divider />
            <ProfileRow
              label="Risk tolerance"
              value={riskTolerance}
              valueClass={riskToneClass(profile?.riskTolerance ?? null)}
              divider
            />
            <ProfileRow label="Retirement age" value={retirementAge} divider />
            <ProfileRow label="Dependents" value={dependentCount} divider />
            <ProfileRow
              label="HDHP enrolled"
              value={profile?.hasHDHP ? 'Yes' : 'No'}
              divider
            />
            <ProfileRow
              label="PSLF eligible"
              value={profile?.isPSLFEligible ? 'Yes' : 'No'}
              divider
            />
          </div>
        )}
      </section>

      {/* Income & employment */}
      <section className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium">
            Income & employment
          </h3>
          {!isDemoMode && editSection !== 'income' && (
            <button
              onClick={() => openEdit('income')}
              className="text-xs font-medium text-accent min-h-[32px] px-2"
            >
              Edit
            </button>
          )}
        </div>
        {editSection === 'income' && !isDemoMode ? (
          <EditCard title="Income & employment" onCancel={() => setEditSection(null)}>
            <IncomeEditFields formData={formData} setFormData={setFormData} />
            {saveError && (
              <div className="text-xs text-accent" role="alert">{saveError}</div>
            )}
            <EditActions
              onSave={saveProfile}
              onCancel={() => setEditSection(null)}
              saving={savingProfile}
            />
          </EditCard>
        ) : (
          <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm overflow-hidden">
            <ProfileRow label="Employment" value={employmentType} />
            <ProfileRow label="Gross income" value={grossIncome} divider />
            <ProfileRow label="Employer match" value={employerMatch} divider />
          </div>
        )}
      </section>

      {/* Preferences (notifications) */}
      <section className="mb-5">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium mb-2">
          Preferences
        </h3>
        <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm overflow-hidden">
          <ToggleRow
            title="Daily reminders"
            subtitle="One nudge a day about your next step"
            checked={!!user?.notifyDaily}
            onChange={() => togglePref('notifyDaily')}
          />
          <ToggleRow
            title="Bill reminders"
            subtitle="Heads up a few days before"
            checked={!!user?.notifyBills}
            onChange={() => togglePref('notifyBills')}
            divider
          />
          <ToggleRow
            title="Weekly summary email"
            subtitle="Sunday recap"
            checked={!!user?.notifyWeeklyEmail}
            onChange={() => togglePref('notifyWeeklyEmail')}
            divider
          />
        </div>
        {prefError && (
          <div className="text-xs text-accent mt-2" role="alert">{prefError}</div>
        )}
      </section>

      {/* Account & session — combines Security + Sign out so session controls live together */}
      <section className="mb-5">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium mb-2">
          Account & session
        </h3>
        <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm overflow-hidden">
          {!showPasswordForm ? (
            <button
              onClick={() => {
                setShowPasswordForm(true);
                setPasswordMessage(null);
              }}
              className="w-full flex items-center justify-between p-4 text-left min-h-[44px]"
              disabled={isDemoMode}
            >
              <div className="text-sm font-medium">Change password</div>
              <div className="text-text-muted">›</div>
            </button>
          ) : (
            <PasswordForm
              currentPassword={currentPassword}
              newPassword={newPassword}
              confirmPassword={confirmPassword}
              setCurrentPassword={setCurrentPassword}
              setNewPassword={setNewPassword}
              setConfirmPassword={setConfirmPassword}
              passwordMessage={passwordMessage}
              savingPassword={savingPassword}
              onSubmit={handleChangePassword}
              onCancel={() => {
                setShowPasswordForm(false);
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                setPasswordMessage(null);
              }}
            />
          )}
          <button
            onClick={() => setConfirmSignOut(true)}
            className="w-full flex items-center justify-between p-4 text-left min-h-[44px] border-t border-rule/60"
          >
            <div className="text-sm font-medium">Sign out</div>
            <div className="text-text-muted">›</div>
          </button>
        </div>
        {passwordMessage && passwordMessage.kind === 'ok' && !showPasswordForm && (
          <div className="text-xs text-success mt-2 text-center">{passwordMessage.text}</div>
        )}
      </section>

      {/* Privacy */}
      <section className="mb-5">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium mb-2">
          Privacy
        </h3>
        <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-rule/60 min-h-[44px] opacity-60">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">What Lasagna shares with the AI</div>
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-bg border border-rule text-text-muted">
                Soon
              </span>
            </div>
          </div>
          <a
            href="mailto:support@lasagnafi.com?subject=Export%20my%20Lasagna%20data"
            className="flex items-center justify-between p-4 border-b border-rule/60 min-h-[44px]"
          >
            <div className="text-sm font-medium">Download your data</div>
            <div className="text-text-muted">›</div>
          </a>
          <button
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
            disabled={isDemoMode}
            className="w-full flex items-center justify-between p-4 min-h-[44px] text-left disabled:opacity-50"
          >
            <div className="text-sm font-medium text-accent">Delete account</div>
            <div className="text-text-muted">›</div>
          </button>
        </div>
        {deleteError && (
          <div className="text-xs text-accent mt-2 text-center" role="alert">{deleteError}</div>
        )}
      </section>

      <p className="text-[11px] text-text-muted text-center pt-2 pb-4 font-mono">
        Lasagna v0.1.0 · Built in the open
      </p>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out?"
        message="You'll need to sign back in to see your accounts and insights."
        confirmLabel="Sign out"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={async () => {
          await logout();
          setLocation('/');
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete your account?"
        message="This permanently removes your profile, connected institutions, and Lasagna history. This cannot be undone."
        typeToConfirm="DELETE"
        confirmLabel="Delete forever"
        destructive
        busy={deletingAccount}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDeleteAccount}
      />
    </SimpleShell>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProfileRow({
  label,
  value,
  valueClass,
  divider,
}: {
  label: string;
  value: string;
  valueClass?: string;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between p-4 ${
        divider ? 'border-t border-rule/60' : ''
      }`}
    >
      <span className="text-sm text-text-muted">{label}</span>
      <span className={`text-sm font-medium ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}

function ToggleRow({
  title,
  subtitle,
  checked,
  onChange,
  divider,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: () => void;
  divider?: boolean;
}) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      className={`w-full flex items-center justify-between p-4 text-left min-h-[44px] ${
        divider ? 'border-t border-rule/60' : ''
      }`}
    >
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-text-muted">{subtitle}</div>
      </div>
      <div
        className={`w-10 h-6 rounded-full relative transition-colors ${
          checked ? 'bg-accent' : 'bg-rule'
        }`}
      >
        <div
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
            checked ? 'right-0.5' : 'left-0.5'
          }`}
        />
      </div>
    </button>
  );
}

function EditCard({
  title,
  children,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-base font-serif font-medium">{title}</h4>
        <button
          onClick={onCancel}
          className="text-text-muted text-lg w-8 h-8 grid place-items-center"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

interface ProfileFormData {
  dateOfBirth: string;
  annualIncome: string;
  filingStatus: string;
  stateOfResidence: string;
  riskTolerance: string;
  employerMatchPercent: string;
  retirementAge: string;
  employmentType: string;
  dependentCount: string;
  hasHDHP: boolean;
  isPSLFEligible: boolean;
}

function PersonalEditFields({
  formData,
  setFormData,
}: {
  formData: ProfileFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProfileFormData>>;
}) {
  const dobId = useId();
  const filingId = useId();
  const stateId = useId();
  const riskId = useId();
  const retireId = useId();
  const depsId = useId();
  return (
    <>
      <FieldLabel htmlFor={dobId}>Date of birth</FieldLabel>
      <InputField
        id={dobId}
        type="date"
        value={formData.dateOfBirth}
        onChange={(v) => setFormData((f) => ({ ...f, dateOfBirth: v }))}
      />
      <FieldLabel htmlFor={filingId}>Filing status</FieldLabel>
      <SelectField
        id={filingId}
        value={formData.filingStatus}
        onChange={(v) => setFormData((f) => ({ ...f, filingStatus: v }))}
        options={[{ value: '', label: 'Select…' }, ...FILING_STATUS_OPTIONS]}
      />
      <FieldLabel htmlFor={stateId}>State of residence</FieldLabel>
      <SelectField
        id={stateId}
        value={formData.stateOfResidence}
        onChange={(v) => setFormData((f) => ({ ...f, stateOfResidence: v }))}
        options={[{ value: '', label: 'Select…' }, ...US_STATE_OPTIONS]}
      />
      <FieldLabel htmlFor={riskId}>Risk tolerance</FieldLabel>
      <SelectField
        id={riskId}
        value={formData.riskTolerance}
        onChange={(v) => setFormData((f) => ({ ...f, riskTolerance: v }))}
        options={[{ value: '', label: 'Select…' }, ...RISK_TOLERANCE_OPTIONS]}
      />
      <FieldLabel htmlFor={retireId}>Retirement age</FieldLabel>
      <InputField
        id={retireId}
        type="number"
        value={formData.retirementAge}
        placeholder="65"
        onChange={(v) => setFormData((f) => ({ ...f, retirementAge: v }))}
      />
      <FieldLabel htmlFor={depsId}>Number of dependents</FieldLabel>
      <InputField
        id={depsId}
        type="number"
        value={formData.dependentCount}
        placeholder="0"
        onChange={(v) => setFormData((f) => ({ ...f, dependentCount: v }))}
      />
      <CheckRow
        label="Enrolled in a high-deductible health plan (HDHP)"
        checked={formData.hasHDHP}
        onChange={(c) => setFormData((f) => ({ ...f, hasHDHP: c }))}
      />
      <CheckRow
        label="Work in public service (PSLF eligible)"
        checked={formData.isPSLFEligible}
        onChange={(c) => setFormData((f) => ({ ...f, isPSLFEligible: c }))}
      />
    </>
  );
}

function IncomeEditFields({
  formData,
  setFormData,
}: {
  formData: ProfileFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProfileFormData>>;
}) {
  const empId = useId();
  const incomeId = useId();
  const matchId = useId();
  return (
    <>
      <FieldLabel htmlFor={empId}>Employment type</FieldLabel>
      <SelectField
        id={empId}
        value={formData.employmentType}
        onChange={(v) => setFormData((f) => ({ ...f, employmentType: v }))}
        options={EMPLOYMENT_TYPE_OPTIONS}
      />
      <FieldLabel htmlFor={incomeId}>Annual gross income ($)</FieldLabel>
      <InputField
        id={incomeId}
        type="number"
        value={formData.annualIncome}
        placeholder="72000"
        onChange={(v) => setFormData((f) => ({ ...f, annualIncome: v }))}
      />
      <FieldLabel htmlFor={matchId}>Employer match (%)</FieldLabel>
      <InputField
        id={matchId}
        type="number"
        value={formData.employerMatchPercent}
        placeholder="4"
        onChange={(v) => setFormData((f) => ({ ...f, employerMatchPercent: v }))}
      />
    </>
  );
}

function PasswordForm({
  currentPassword,
  newPassword,
  confirmPassword,
  setCurrentPassword,
  setNewPassword,
  setConfirmPassword,
  passwordMessage,
  savingPassword,
  onSubmit,
  onCancel,
}: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  setCurrentPassword: (v: string) => void;
  setNewPassword: (v: string) => void;
  setConfirmPassword: (v: string) => void;
  passwordMessage: { kind: 'ok' | 'err'; text: string } | null;
  savingPassword: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const curId = useId();
  const newId = useId();
  const confirmId = useId();
  const errId = useId();
  const isErr = passwordMessage?.kind === 'err';
  return (
    <div className="p-4 flex flex-col gap-3">
      <FieldLabel htmlFor={curId}>Current password</FieldLabel>
      <InputField
        id={curId}
        type="password"
        value={currentPassword}
        onChange={setCurrentPassword}
        placeholder="••••••••"
      />
      <FieldLabel htmlFor={newId}>New password</FieldLabel>
      <InputField
        id={newId}
        type="password"
        value={newPassword}
        onChange={setNewPassword}
        placeholder="At least 8 characters"
        aria-invalid={isErr}
        aria-describedby={isErr ? errId : undefined}
      />
      <FieldLabel htmlFor={confirmId}>Confirm new password</FieldLabel>
      <InputField
        id={confirmId}
        type="password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        placeholder="Repeat new password"
        aria-invalid={isErr}
        aria-describedby={isErr ? errId : undefined}
      />
      {passwordMessage && (
        <div
          id={errId}
          role={isErr ? 'alert' : undefined}
          className={`text-xs ${isErr ? 'text-accent' : 'text-success'}`}
        >
          {passwordMessage.text}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSubmit}
          disabled={savingPassword}
          className="flex-1 rounded-xl bg-text text-white py-3 text-sm font-medium min-h-[44px] disabled:opacity-50"
        >
          {savingPassword ? 'Saving…' : 'Update password'}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-xl bg-bg border border-rule text-text-secondary py-3 text-sm font-medium min-h-[44px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium mt-1"
    >
      {children}
    </label>
  );
}

function InputField({
  id,
  type,
  value,
  onChange,
  placeholder,
  maxLength,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: {
  id?: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      className="w-full rounded-lg bg-bg border border-rule px-3 py-2.5 text-sm focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15 min-h-[44px]"
    />
  );
}

function SelectField({
  id,
  value,
  onChange,
  options,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg bg-bg border border-rule px-3 py-2.5 text-sm focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15 min-h-[44px]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (c: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 py-2 cursor-pointer select-none min-h-[44px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-accent cursor-pointer"
      />
      <span className="text-sm text-text-secondary">{label}</span>
    </label>
  );
}

function EditActions({
  onSave,
  onCancel,
  saving,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex gap-2 pt-2">
      <button
        onClick={onSave}
        disabled={saving}
        className="flex-1 rounded-xl bg-text text-white py-3 text-sm font-medium min-h-[44px] disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        onClick={onCancel}
        className="flex-1 rounded-xl bg-bg border border-rule text-text-secondary py-3 text-sm font-medium min-h-[44px]"
      >
        Cancel
      </button>
    </div>
  );
}
