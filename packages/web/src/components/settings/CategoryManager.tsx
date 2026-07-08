import React, { useState } from 'react';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, type TaxonomyCategory, type TaxonomyGroup } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Alert, Badge, Button, Field, Input, Modal, Select, Skeleton, Surface } from '../uikit';
import { useConfirm } from '../ds';
import { categoryOptionLabel, taxonomyIcon, useTaxonomy } from '../../lib/taxonomy';

// ---------------------------------------------------------------------------
// CategoryManager — Settings section for the tenant taxonomy. Groups render as
// collapsible lists; categories rename inline, disable via toggle (hidden for
// the locked three), and custom categories delete with a reassign picker.
// Every mutation goes through the API then `refresh()`es the shared provider,
// so pickers across the app pick the change up without a reload.
// ---------------------------------------------------------------------------

type GroupType = 'income' | 'expense' | 'transfer';

const GROUP_TYPE_BADGE: Record<GroupType, 'positive' | 'brand' | 'info'> = {
  income: 'positive',
  expense: 'brand',
  transfer: 'info',
};

function MiniToggle({ checked, onChange, label, disabled }: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onChange}
      disabled={disabled}
      className="ui-focus touch-target grid shrink-0 place-items-center rounded-full disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative block h-[22px] w-[38px] rounded-full transition-colors duration-150 ease-ui',
          checked ? 'bg-brand' : 'bg-line-strong',
        )}
      >
        <span
          className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-panel shadow-ui-sm transition-[left] duration-150 ease-ui"
          style={{ left: checked ? 18 : 2 }}
        />
      </span>
    </button>
  );
}

export function CategoryManager() {
  const { groups, loading, error: taxonomyError, byId, bySystemKey, refresh } = useTaxonomy();
  const confirm = useConfirm();

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'category' | 'group'; id: string; value: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Modals
  const [newCat, setNewCat] = useState<{ name: string; groupId: string; emoji: string } | null>(null);
  const [newGroup, setNewGroup] = useState<{ name: string; type: GroupType } | null>(null);
  const [deleting, setDeleting] = useState<{ cat: TaxonomyCategory; reassignTo: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);

  const totalCategories = groups.reduce((s, g) => s + g.categories.length, 0);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  }

  async function commitRename() {
    if (!renaming) return;
    const r = renaming;
    setRenaming(null);
    const name = r.value.trim();
    const currentName = r.kind === 'category'
      ? byId.get(r.id)?.name
      : groups.find((g) => g.id === r.id)?.name;
    if (!name || name === currentName) return;
    await run(r.id, () =>
      r.kind === 'category'
        ? api.updateCategory(r.id, { name })
        : api.updateCategoryGroup(r.id, { name }),
    );
  }

  async function handleDeleteGroup(group: TaxonomyGroup) {
    const ok = await confirm({
      title: `Delete the “${group.name}” group?`,
      body: 'Only empty custom groups can be deleted.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await run(group.id, () => api.deleteCategoryGroup(group.id));
  }

  async function handleCreateCategory() {
    if (!newCat) return;
    const name = newCat.name.trim();
    if (!name) { setModalError('Name is required.'); return; }
    if (!newCat.groupId) { setModalError('Choose a group.'); return; }
    setModalBusy(true);
    setModalError(null);
    try {
      await api.createCategory({ name, groupId: newCat.groupId, emoji: newCat.emoji.trim() || null });
      await refresh();
      setOpenGroups((prev) => new Set(prev).add(newCat.groupId));
      setNewCat(null);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setModalBusy(false);
    }
  }

  async function handleCreateGroup() {
    if (!newGroup) return;
    const name = newGroup.name.trim();
    if (!name) { setModalError('Name is required.'); return; }
    setModalBusy(true);
    setModalError(null);
    try {
      await api.createCategoryGroup({ name, type: newGroup.type });
      await refresh();
      setNewGroup(null);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setModalBusy(false);
    }
  }

  async function handleDeleteCategory() {
    if (!deleting) return;
    if (!deleting.reassignTo) { setModalError('Choose a category to move transactions to.'); return; }
    setModalBusy(true);
    setModalError(null);
    try {
      await api.deleteCategory(deleting.cat.id, deleting.reassignTo);
      await refresh();
      setDeleting(null);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setModalBusy(false);
    }
  }

  const renameInput = (r: NonNullable<typeof renaming>) => (
    <Input
      autoFocus
      value={r.value}
      onChange={(e) => setRenaming({ ...r, value: e.target.value })}
      onBlur={() => void commitRename()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
        if (e.key === 'Escape') setRenaming(null);
      }}
      maxLength={80}
      className="h-8 max-w-[240px] text-[13px]"
      aria-label="New name"
    />
  );

  // Reassign picker options: every enabled category except the one being deleted.
  const reassignGroups = deleting
    ? groups
        .map((group) => ({
          group,
          categories: group.categories.filter((c) => !c.disabled && c.id !== deleting.cat.id),
        }))
        .filter((g) => g.categories.length > 0)
    : [];

  if (taxonomyError && groups.length === 0) {
    return (
      <Surface className="p-5 space-y-3">
        <Alert tone="negative" title="Couldn't load categories">
          {taxonomyError}
        </Alert>
        <Button variant="secondary" size="sm" onClick={() => void refresh()}>
          Retry
        </Button>
      </Surface>
    );
  }

  if (loading && groups.length === 0) {
    return (
      <Surface className="p-5">
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-ui-md" />)}
        </div>
      </Surface>
    );
  }

  return (
    <>
      <Surface pad="none" className="overflow-hidden">
        {/* Header strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 className="font-editorial text-[19px] font-bold leading-[1.15] tracking-[-0.018em] text-content">Categories</h3>
            <p className="ui-tnum mt-0.5 text-[12.5px] font-medium text-content-muted">
              {groups.length} groups · {totalCategories} categories
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus size={14} />}
              onClick={() => { setModalError(null); setNewCat({ name: '', groupId: '', emoji: '' }); }}
            >
              New category
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Plus size={14} />}
              onClick={() => { setModalError(null); setNewGroup({ name: '', type: 'expense' }); }}
            >
              New group
            </Button>
          </div>
        </div>

        {error && <p className="px-5 pb-3 text-[12.5px] font-medium text-negative sm:px-6">{error}</p>}

        <div className="border-t border-line">
          {groups.map((group) => {
            const open = openGroups.has(group.id);
            const isCustomGroup = group.systemKey === null;
            const renamingGroup = renaming?.kind === 'group' && renaming.id === group.id;
            return (
              <div key={group.id} className="border-t border-line first:border-t-0">
                {/* Group header row */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4">
                  {renamingGroup ? (
                    <div className="flex min-h-touch min-w-0 flex-1 items-center gap-2.5 px-1">
                      <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-content-muted transition-transform', !open && '-rotate-90')} />
                      {renameInput(renaming)}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      aria-expanded={open}
                      className="ui-focus flex min-h-touch min-w-0 flex-1 items-center gap-2.5 rounded-ui-sm px-1 text-left"
                    >
                      <ChevronDown size={16} className={cn('shrink-0 text-content-muted transition-transform', !open && '-rotate-90')} aria-hidden />
                      <span className="truncate text-[14px] font-bold text-content">{group.name}</span>
                      <Badge tone={GROUP_TYPE_BADGE[group.type]} size="sm">{group.type}</Badge>
                      <span className="ui-tnum text-[12px] font-semibold text-content-muted">{group.categories.length}</span>
                    </button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 min-h-0 min-w-0 shrink-0"
                    aria-label={`Rename ${group.name}`}
                    onClick={() => setRenaming({ kind: 'group', id: group.id, value: group.name })}
                  >
                    <Pencil size={14} />
                  </Button>
                </div>

                {open && (
                  <div className="border-t border-line bg-canvas-sunken/40">
                    {/* Custom-group controls: type + delete (system groups keep their type) */}
                    {isCustomGroup && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2 pl-10 sm:px-5 sm:pl-12">
                        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-content-muted">
                          Type
                          <Select
                            value={group.type}
                            onChange={(e) => void run(group.id, () => api.updateCategoryGroup(group.id, { type: e.target.value as GroupType }))}
                            className="h-8 w-auto py-0 text-[12.5px]"
                            aria-label={`Type of ${group.name}`}
                          >
                            <option value="expense">Expense</option>
                            <option value="income">Income</option>
                            <option value="transfer">Transfer</option>
                          </Select>
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-negative hover:text-negative"
                          leadingIcon={<Trash2 size={14} />}
                          disabled={group.categories.length > 0 || busyId === group.id}
                          onClick={() => void handleDeleteGroup(group)}
                        >
                          Delete group
                        </Button>
                        {group.categories.length > 0 && (
                          <span className="text-[12px] font-medium text-content-muted">Move or delete its categories first</span>
                        )}
                      </div>
                    )}

                    {group.categories.map((cat) => {
                      const renamingCat = renaming?.kind === 'category' && renaming.id === cat.id;
                      return (
                        <div
                          key={cat.id}
                          className="flex items-center gap-3 border-t border-line px-4 py-2 pl-10 first:border-t-0 sm:px-5 sm:pl-12"
                        >
                          <span className={cn(
                            'grid h-8 w-8 shrink-0 place-items-center rounded-ui-md bg-canvas-sunken text-content-secondary',
                            cat.disabled && 'opacity-50',
                          )}>
                            {taxonomyIcon(cat)}
                          </span>
                          {renamingCat ? (
                            <div className="min-w-0 flex-1">{renameInput(renaming)}</div>
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-content">
                              {/* Dim only the name — opacity on the parent would dim the badge too. */}
                              <span className={cn(cat.disabled && 'text-content-muted opacity-60')}>{cat.name}</span>
                              {cat.disabled && <Badge tone="neutral" size="sm" className="ml-2 align-middle">Off</Badge>}
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 min-h-0 min-w-0 shrink-0"
                            aria-label={`Rename ${cat.name}`}
                            onClick={() => setRenaming({ kind: 'category', id: cat.id, value: cat.name })}
                          >
                            <Pencil size={14} />
                          </Button>
                          {cat.systemKey === null && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 min-h-0 min-w-0 shrink-0 text-negative hover:text-negative"
                              aria-label={`Delete ${cat.name}`}
                              onClick={() => {
                                setModalError(null);
                                setDeleting({ cat, reassignTo: bySystemKey.get('other')?.id ?? '' });
                              }}
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                          {/* Disable toggle — hidden entirely for the locked three */}
                          {!cat.locked && (
                            <MiniToggle
                              checked={!cat.disabled}
                              disabled={busyId === cat.id}
                              label={cat.disabled ? `Enable ${cat.name}` : `Disable ${cat.name}`}
                              onChange={() => void run(cat.id, () => api.updateCategory(cat.id, { disabled: !cat.disabled }))}
                            />
                          )}
                        </div>
                      );
                    })}
                    {group.categories.length === 0 && (
                      <p className="px-4 py-2.5 pl-10 text-[12.5px] font-medium text-content-muted sm:px-5 sm:pl-12">
                        No categories yet.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Surface>

      {/* New category modal */}
      <Modal
        open={newCat !== null}
        onClose={() => setNewCat(null)}
        title="New category"
        description="Custom categories can be renamed, moved, or deleted any time."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setNewCat(null)} disabled={modalBusy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void handleCreateCategory()} loading={modalBusy}>
              {modalBusy ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        {newCat && (
          <div className="space-y-4">
            <Field label="Name" required>
              <Input
                autoFocus
                value={newCat.name}
                onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
                maxLength={80}
                placeholder="e.g. Pet Care"
              />
            </Field>
            <Field label="Group" required>
              <Select value={newCat.groupId} onChange={(e) => setNewCat({ ...newCat, groupId: e.target.value })}>
                <option value="" disabled>Choose a group…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Emoji" hint="Optional — shows next to the name in pickers">
              <Input
                value={newCat.emoji}
                onChange={(e) => setNewCat({ ...newCat, emoji: e.target.value })}
                maxLength={8}
                placeholder="🐶"
                className="w-24"
              />
            </Field>
            {modalError && <p className="text-[12.5px] font-medium text-negative">{modalError}</p>}
          </div>
        )}
      </Modal>

      {/* New group modal */}
      <Modal
        open={newGroup !== null}
        onClose={() => setNewGroup(null)}
        title="New group"
        description="Groups organize categories and set how they count (income, expense, or transfer)."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setNewGroup(null)} disabled={modalBusy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void handleCreateGroup()} loading={modalBusy}>
              {modalBusy ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        {newGroup && (
          <div className="space-y-4">
            <Field label="Name" required>
              <Input
                autoFocus
                value={newGroup.name}
                onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                maxLength={80}
                placeholder="e.g. Side Business"
              />
            </Field>
            <Field label="Type" required>
              <Select value={newGroup.type} onChange={(e) => setNewGroup({ ...newGroup, type: e.target.value as GroupType })}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </Select>
            </Field>
            {modalError && <p className="text-[12.5px] font-medium text-negative">{modalError}</p>}
          </div>
        )}
      </Modal>

      {/* Delete custom category modal (with reassign picker) */}
      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete “${deleting.cat.name}”?` : undefined}
        description="Its transactions and rules move to the category you pick — history stays intact."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDeleting(null)} disabled={modalBusy}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => void handleDeleteCategory()} loading={modalBusy}>
              {modalBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        {deleting && (
          <div className="space-y-4">
            <Field label="Reassign transactions to" required>
              <Select value={deleting.reassignTo} onChange={(e) => setDeleting({ ...deleting, reassignTo: e.target.value })}>
                {reassignGroups.map(({ group, categories }) => (
                  <optgroup key={group.id} label={group.name}>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{categoryOptionLabel(cat)}</option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            {modalError && <p className="text-[12.5px] font-medium text-negative">{modalError}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}
