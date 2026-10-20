/** Fixture chart series. Values are fixed literals; labels follow the language. */
import type { SpecimenLang } from '../specimen';

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
};

const REVENUE = [12400, 13100, 12850, 14900, 16200, 15800, 17400, 18900, 18100, 20300, 21800, 23900];
const COSTS = [9800, 10100, 10400, 10900, 11200, 11300, 11900, 12500, 12300, 13100, 13600, 14200];
const USERS = [310, 342, 365, 401, 455, 470, 512, 560, 571, 620, 668, 731];

export interface MonthPoint {
  month: string;
  revenue: number;
  costs: number;
  users: number;
}

/** Twelve monthly points (revenue, costs, users). */
export function fixtureMonthlySeries(lang: SpecimenLang = 'en'): MonthPoint[] {
  return MONTHS[lang].map((month, index) => ({ month, revenue: REVENUE[index], costs: COSTS[index], users: USERS[index] }));
}

/** A share breakdown for pie and bar charts. */
export function fixtureShares(lang: SpecimenLang = 'en'): Array<{ name: string; value: number }> {
  const names = lang === 'fr'
    ? ['Recherche naturelle', 'Réseaux sociaux', 'Acces direct', 'Recommandations']
    : ['Organic search', 'Social', 'Direct', 'Referrals'];
  return names.map((name, index) => ({ name, value: [42, 27, 19, 12][index] }));
}

/** A short numeric series for sparklines. */
export const SPARK_VALUES: readonly number[] = [4, 6, 5, 8, 7, 9, 12, 11, 13, 12, 15, 17];
