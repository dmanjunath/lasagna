import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, type CategoryRule } from '../../lib/api';
import { Button, Skeleton, Surface } from '../uikit';
import { useConfirm } from '../ds';
import { useTaxonomy } from '../../lib/taxonomy';
import { useAccountsIndex } from '../../lib/use-accounts-index';
import { RulesPanel, ruleSentence } from '../rules/RulesPanel';

// ---------------------------------------------------------------------------
// RulesManager — the category rules list on Settings (/profile#rules), built
// like CategoryManager beside it: a header card with New rule, then one row
// per rule as a sentence with edit and delete. RulesPanel is the editor.
// ---------------------------------------------------------------------------

export function RulesManager() {
  const confirm = useConfirm();
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  return (
    <>
      <Surface pad="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          {/* The section heading above already names this card, so it carries
               no title of its own. */}
          <p className="ui-tnum min-w-0 text-[13px] font-medium text-content-muted">
            {loading ? '' : rules.length === 0 ? 'No rules yet' : `${rules.length} rule${rules.length === 1 ? '' : 's'}, applied in this order`}
          </p>
          <Button variant="secondary" size="sm" leadingIcon={<Plus size={14} />} onClick={() => setEditing({ rule: null })}>
            New rule
          </Button>
        </div>

        {error && <p className="px-5 pb-3 text-[12.5px] font-medium text-negative sm:px-6">{error}</p>}

        <div className="border-t border-line">
          {loading ? (
            <div className="space-y-3 p-5 sm:px-6">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-ui-md" />)}
            </div>
          ) : rules.length === 0 ? (
            <p className="px-5 py-5 text-[13.5px] text-content-muted sm:px-6">
              A rule files matching transactions automatically, for example anything containing
              &ldquo;AMZN&rdquo; as Shopping.
            </p>
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
                    className="h-9 w-9 min-h-0 min-w-0 shrink-0"
                    aria-label="Edit rule"
                    onClick={() => setEditing({ rule })}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 min-h-0 min-w-0 shrink-0 text-negative hover:text-negative"
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
