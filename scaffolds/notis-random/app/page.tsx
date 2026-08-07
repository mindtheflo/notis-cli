'use client';

import { useCallback, useMemo, useState } from 'react';
import { useNotis, useNotisNavigation } from '@notis/sdk';
import { DiceFiveIcon as Dices, SparkleIcon as Sparkles, ClockCounterClockwiseIcon as History, ArrowRightIcon as ArrowRight, HashIcon as Hash, PercentIcon as Percent, InfinityIcon, ArrowClockwiseIcon as RefreshCw, WarningCircleIcon as WarningCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn, formatNumber, relativeTime } from '@/lib/utils';
import { DICE_SIDES, DEFAULT_DICE_SIDES, type DiceSides, type Mode, type Roll, checkBounds, parseBoundDraft, roll } from '@/lib/rng';
import { normalizeRollRecord, sortRollRecordsDesc } from '@/lib/roll-record';
import { usePersistRoll, useRollDocuments } from '@/lib/notis-tools';

const MODES: Array<{ id: Mode; label: string; icon: typeof Hash; hint: string }> = [
  { id: 'integer', label: 'Integer', icon: Hash,        hint: 'Whole numbers only' },
  { id: 'decimal', label: 'Decimal', icon: Percent,     hint: 'Continuous range'   },
  { id: 'dice',    label: 'Dice',    icon: Dices,       hint: 'Standard polyhedral dice' },
];

export default function HomePage() {
  const { app, ready } = useNotis();
  const nav = useNotisNavigation();
  const { documents, loading, refetch } = useRollDocuments(5);
  const { persist: persistRoll } = usePersistRoll();

  const [mode, setMode] = useState<Mode>('integer');
  const [minDraft, setMinDraft] = useState('1');
  const [maxDraft, setMaxDraft] = useState('100');
  const [sides, setSides] = useState<DiceSides>(DEFAULT_DICE_SIDES);
  const [current, setCurrent] = useState<Roll | null>(null);
  const [rolling, setRolling] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const recent = useMemo(
    () => documents
      .map(normalizeRollRecord)
      .sort(sortRollRecordsDesc)
      .slice(0, 5),
    [documents],
  );

  // Dice mode draws from 1..sides; the manual range inputs drive the other modes.
  const bounds = useMemo(
    () => (
      mode === 'dice'
        ? { min: 1, max: sides }
        : {
            min: parseBoundDraft(minDraft),
            max: parseBoundDraft(maxDraft),
          }
    ),
    [mode, sides, minDraft, maxDraft],
  );
  const check = useMemo(
    () => checkBounds(bounds.min, bounds.max, mode),
    [bounds.min, bounds.max, mode],
  );

  const generate = useCallback(async () => {
    if (rolling || !check.ok) return;
    setRolling(true);
    setSaveError(null);
    try {
      // roll() throws on unusable bounds, and persist() can fail on the network.
      // Both have to leave `rolling` false or the button would stay stuck.
      const next = roll(bounds.min, bounds.max, mode);
      setCurrent(next);
      await persistRoll(next);
      refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this roll.');
    } finally {
      setRolling(false);
    }
  }, [rolling, check.ok, bounds.min, bounds.max, mode, persistRoll, refetch]);

  return (
    <main data-store-screenshot="generator" className="notis-random-shell space-y-6">
      <header className="flex items-start justify-between gap-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{ready ? app?.name : 'Loading…'}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Generator</h1>
          <p className="text-sm text-muted-foreground max-w-md">
            Pick a mode, set the range, and press generate. Every roll is saved to the History view.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2 border-border text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </header>

      {/* The dial and the controls sit side by side so the whole generator —
          result, mode, range, and recent rolls — stays above the fold. */}
      <section className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
        <Card className="flex flex-col items-center justify-center gap-5 rounded-2xl p-6">
          <div
            className={cn(
              'flex items-center justify-center rounded-full border border-border bg-background',
              'h-40 w-40 transition-transform',
              rolling && 'animate-pulse',
            )}
          >
            {current ? (
              <span className="font-mono text-5xl font-semibold tabular-nums text-foreground">
                {formatNumber(current.value)}
              </span>
            ) : (
              <InfinityIcon className="h-10 w-10 text-muted-foreground" strokeWidth={1.2} />
            )}
          </div>
          <Button
            type="button"
            size="lg"
            data-action="generate"
            onClick={generate}
            disabled={rolling || !check.ok}
            className="gap-2 rounded-full px-6"
          >
            <Dices className="h-4 w-4" />
            {rolling ? 'Rolling…' : current ? 'Roll again' : 'Generate'}
          </Button>
          {check.issue ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <WarningCircle className="h-3.5 w-3.5 shrink-0" />
              {check.issue.message}
            </p>
          ) : current ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">[{formatNumber(current.min)}, {formatNumber(current.max)}]</span>
              {' · '}{current.mode}
            </p>
          ) : null}
          {saveError && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <WarningCircle className="h-3.5 w-3.5 shrink-0" />
              {saveError}
            </p>
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-medium text-foreground">Mode</h2>
          <div className="grid gap-2">
            {MODES.map(({ id, label, icon: Icon, hint }) => (
              <Button
                key={id}
                type="button"
                variant="outline"
                data-mode={id}
                onClick={() => setMode(id)}
                className={cn(
                  'h-auto w-full justify-start gap-3 px-3 py-2.5 text-left whitespace-normal',
                  mode === id
                    ? 'border-foreground bg-accent text-accent-foreground'
                    : 'border-border hover:bg-accent/50',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{hint}</div>
                </div>
              </Button>
            ))}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-medium text-foreground">
            {mode === 'dice' ? 'Die' : 'Range'}
          </h2>
          {mode === 'dice' ? (
            <>
              <div className="flex flex-wrap gap-2">
                {DICE_SIDES.map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant="outline"
                    data-die={n}
                    onClick={() => setSides(n)}
                    className={cn(
                      'h-10 min-w-[3.25rem] px-3 font-mono',
                      sides === n
                        ? 'border-foreground bg-accent text-accent-foreground'
                        : 'border-border hover:bg-accent/50',
                    )}
                  >
                    d{n}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Rolls a whole number from 1 to {sides}, each equally likely.
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <RangeInput label="Minimum" name="min" value={minDraft} onChange={setMinDraft} />
                <RangeInput label="Maximum" name="max" value={maxDraft} onChange={setMaxDraft} />
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === 'decimal'
                  ? 'Decimal draws include the minimum but never reach the maximum.'
                  : 'Integer draws include both ends of the range.'}
              </p>
            </>
          )}
        </Card>
        </div>
      </section>

      <Card className="p-5">
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <History className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            Recent rolls
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => nav.toRoute('/history')}
            className="h-auto gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Button>
        </header>
        {loading && recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : recent.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing rolled yet. Press Generate to see history here.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-lg tabular-nums text-foreground">{formatNumber(r.value)}</span>
                  <span className="text-xs text-muted-foreground">{r.mode}</span>
                </div>
                <span className="text-xs text-muted-foreground">{relativeTime(r.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

function RangeInput({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        type="text"
        inputMode="decimal"
        data-bound={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-border font-mono"
      />
    </label>
  );
}
