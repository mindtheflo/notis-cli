import type { NotisRuntime } from '@notis/sdk';

/** Build Notion-shape property values, mirroring what the portal runtime returns. */
function text(content: string) {
  return { type: 'rich_text', rich_text: [{ type: 'text', text: { content } }] };
}
function date(iso: string) {
  return { type: 'date', date: { start: iso, end: '', timezone: null } };
}
function number(n: number) {
  return { type: 'number', number: n };
}
function title(content: string) {
  return { type: 'title', title: [{ type: 'text', text: { content } }] };
}

function dayISO(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

type Seed = {
  offset: number;
  morningMood?: number;
  morningWord?: string;
  feeling?: string;
  energy?: number;
  motivation?: number;
  gratitudes?: [string, string, string] | [string, string] | [string];
  intention?: string;
  affirmation?: string;
  dayMood?: number;
  dayWord?: string;
  highlight?: string;
  lesson?: string;
  freeEntry?: string;
};

const SEEDS: Seed[] = [
  {
    offset: 0,
    morningMood: 6,
    morningWord: 'rested',
    feeling: 'Calm and a little excited about the demo this afternoon.',
    energy: 8,
    motivation: 9,
    gratitudes: [
      'A slow coffee on the balcony before anyone was awake',
      'Camille laughing at my terrible pun last night',
      'That my back finally feels normal again',
    ],
    intention: 'One deep-work block on the launch page before opening messages.',
    affirmation: 'I am allowed to do one thing at a time.',
    // Evening not captured yet — today.
  },
  {
    offset: 1,
    morningMood: 4,
    morningWord: 'foggy',
    feeling: 'Slept badly, brain still booting.',
    energy: 4,
    motivation: 6,
    gratitudes: [
      'Rain on the window while working',
      'The boulangerie was still open at 19:30',
      'A friend checking in for no reason',
    ],
    intention: 'Keep the day small: ship the fix, walk at lunch.',
    affirmation: 'I am steady even on slow days.',
    dayMood: 6,
    dayWord: 'redeemed',
    highlight: 'The afternoon walk turned into an hour of ideas with Théo.',
    lesson: 'A rough morning predicts nothing about the afternoon.',
    freeEntry:
      'Started the day convinced it was a write-off. By 16:00 the fix was shipped and the walk with Théo unknotted the roadmap question that has been bugging me for a week. Note to self: leave the house earlier.',
  },
  {
    offset: 2,
    morningMood: 7,
    morningWord: 'sunny',
    feeling: 'Woke up before the alarm, ready to go.',
    energy: 9,
    motivation: 9,
    gratitudes: [
      'Eight hours of sleep, finally',
      'The new espresso beans',
      'A clear calendar until noon',
    ],
    intention: 'Finish the investor update and actually send it.',
    affirmation: 'I am building something worth the patience it takes.',
    dayMood: 7,
    dayWord: 'unstoppable',
    highlight: 'Sent the update and got two warm replies within the hour.',
    lesson: 'Momentum compounds when I front-load the scary task.',
  },
  {
    offset: 3,
    morningMood: 3,
    morningWord: 'heavy',
    feeling: 'Anxious about the support backlog.',
    energy: 3,
    motivation: 4,
    gratitudes: [
      'Tea instead of a third coffee',
      'The cat sleeping on my desk all morning',
    ],
    intention: 'Answer ten tickets, then stop counting.',
    affirmation: 'I am more than my inbox.',
    dayMood: 4,
    dayWord: 'okay',
    highlight: 'Closed the hardest ticket with an actual fix, not a workaround.',
    lesson: 'Naming the dread out loud makes it about half as loud.',
  },
  {
    offset: 4,
    morningMood: 5,
    morningWord: 'curious',
    feeling: 'Mildly under-slept but interested in the day.',
    energy: 6,
    motivation: 7,
    gratitudes: [
      'Morning light in the kitchen',
      'A podcast that made the dishes disappear',
      'Knowing exactly what today is for',
    ],
    intention: 'Prototype the stats page before lunch.',
    affirmation: 'I am learning fast enough.',
    dayMood: 6,
    dayWord: 'satisfying',
    highlight: 'The prototype clicked on the third try.',
    lesson: 'The second draft is where the good ideas live.',
    freeEntry: 'Quiet, focused day. The kind that does not make stories but makes progress.',
  },
];

function buildDocuments() {
  return SEEDS.map((s, i) => {
    const iso = dayISO(s.offset);
    const properties: Record<string, unknown> = {
      Name: title(`Journal — ${iso.slice(0, 10)}`),
      Date: date(iso),
    };
    if (s.morningMood != null) properties['Morning Mood'] = number(s.morningMood);
    if (s.morningWord) properties['Morning Mood Word'] = text(s.morningWord);
    if (s.feeling) properties['Morning Feeling'] = text(s.feeling);
    if (s.energy != null) properties['Energy'] = number(s.energy);
    if (s.motivation != null) properties['Motivation'] = number(s.motivation);
    (s.gratitudes ?? []).forEach((g, gi) => {
      properties[`Gratitude ${gi + 1}`] = text(g);
    });
    if (s.intention) properties['Intention'] = text(s.intention);
    if (s.affirmation) properties['Affirmation'] = text(s.affirmation);
    if (s.dayMood != null) properties['Day Mood'] = number(s.dayMood);
    if (s.dayWord) properties['Day Mood Word'] = text(s.dayWord);
    if (s.highlight) properties['Highlight'] = text(s.highlight);
    if (s.lesson) properties['Lesson'] = text(s.lesson);
    return {
      id: `mock_${i}`,
      title: `Journal — ${iso.slice(0, 10)}`,
      content_markdown: s.freeEntry ?? '',
      created_time: iso,
      properties,
    };
  });
}

export function installMockRuntime(): NotisRuntime {
  const documents = buildDocuments();
  return {
    app: { id: 'mock', name: '5 Minutes Journal', slug: 'notis-journal', icon: 'phosphor:notebook' } as never,
    route: { path: '/', slug: 'journal', name: 'Journal' } as never,
    databases: [] as never,
    context: {},
    navigate: (payload) => {
      // eslint-disable-next-line no-console
      console.log('[mock navigate]', payload);
      window.dispatchEvent(new CustomEvent('mock-navigate', { detail: payload }));
    },
    registerTopBarSearch: () => {},
    setTopBarSearchValue: () => {},
    setTopBarSearchLoading: () => {},
    // No change feed in the mock: `useDatabaseSubscription` reports live=false.
    subscribeDatabase: () => () => {},
    async listTools() {
      return [];
    },
    async callTool(name: string) {
      if (name === 'LOCAL_NOTIS_DATABASE_QUERY') {
        return { documents } as never;
      }
      return {} as never;
    },
    async request() {
      return {};
    },
  };
}
