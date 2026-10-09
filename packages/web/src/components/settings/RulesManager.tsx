import { useEffect, useState } from 'react';
import { ListFilter, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, type CategoryRule } from '../../lib/api';
import { Button, EmptyState, Skeleton, Surface, useToast } from '../uikit';
import { useConfirm } from '../ds';
import { useTaxonomy } from '../../lib/taxonomy';
import { cn } from '../../lib/utils';
import { useAccountsIndex } from '../../lib/use-accounts-index';
import { RulesPanel, ruleSentence } from '../rules/RulesPanel';

// ---------------------------------------------------------------------------
// RulesManager — the category rules list on Settings (/profile#rules), built
// like CategoryManager beside it: a header card with New rule, then one row
// per rule as a sentence with edit and delete. RulesPanel is the editor.
// ---------------------------------------------------------------------------

export function RulesManager() {
  const confirm = useConfirm();
  const toast = useToast();
  const { byId } = useTaxonomy();
  const { list: accountIndex } = useAccountsIndex();
  const accounts = accountIndex.map((a) => ({ accountId: a.id, name: a.name }));
  const labelFor = (id: string | null): string => (id ? byId.get(id)?.name : undefined) ?? 'Unknown';

  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = closed; { rule: null } = new rule.
  const [editing, setEditing] = useState<{ rule: CategoryRule | null } | null>(null);

  const load = () => {
    setLoading(true);
    api.getRules()
      .then((data) => setRules(data.rules))
      .catch(() => setError("Couldn't load your rules. Try again."))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Delete this rule?',
      body: 'Existing categories stay as they are.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteRule(id);
      load();
      toast({ tone: 'positive', title: 'Rule deleted' });
    } catch {
      setError("Couldn't delete that rule. Try again.");
    }
  };

  const newRule = (
    <Button variant="secondary" size="sm" leadingIcon={<Plus size={14} />} onClick={() => setEditing({ rule: null })}>
      New rule
    </Button>
  );
  // With no rules the empty state carries New rule, so the header strip would
  // hold nothing else.
  const empty = !loading && rules.length === 0;

  return (
    <>
      <Surface pad="none" className="overflow-hidden">
        {!empty && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
            {/* The section heading above already names this card, so it carries
                 no title of its own. */}
            <p className="ui-tnum min-w-0 text-[13px] font-medium text-content-muted">
              {loading ? '' : `${rules.length} rule${rules.length === 1 ? '' : 's'}, applied in this order`}
            </p>
            {newRule}
          </div>
        )}

        {error && <p className={cn('px-5 pb-3 text-[12.5px] font-medium text-negative sm:px-6', empty && 'pt-4')}>{error}</p>}

        <div className={cn(!empty && 'border-t border-line')}>
          {loading ? (
            <div className="space-y-3 p-5 sm:px-6">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-ui-md" />)}
            </div>
          ) : rules.length === 0 ? (
            <div className="p-3">
              <EmptyState
                icon={<ListFilter size={22} />}
                title="No rules yet"
                // The section hint above already says what a rule does.
                description={<>For example, file anything containing &ldquo;AMZN&rdquo; as Shopping.</>}
                action={newRule}
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                  <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-content">
                    {ruleSentence(rule, accounts, labelFor)}{' '}
                    <span className="text-content-muted">&rarr;</span>{' '}
                    <b className="font-semibold">{labelFor(rule.setCategoryId)}</b>
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 sm:h-9 sm:w-9 sm:min-h-0 sm:min-w-0 shrink-0"
                    aria-label="Edit rule"
                    onClick={() => setEditing({ rule })}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 sm:h-9 sm:w-9 sm:min-h-0 sm:min-w-0 shrink-0 text-negative hover:text-negative"
                    aria-label="Delete rule"
                    onClick={() => void handleDelete(rule.id)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Surface>

      <RulesPanel
        open={editing !== null}
        rule={editing?.rule ?? null}
        seed={null}
        onClose={() => setEditing(null)}
        onChanged={load}
      />
    </>
  );
}
