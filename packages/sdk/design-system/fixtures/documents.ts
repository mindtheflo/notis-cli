/** Fixture document bodies. */
import type { SpecimenLang } from '../specimen';

const MARKDOWN = {
  en: `# Launch plan

We ship the new onboarding on **Monday**. The checklist below tracks what is left.

## Checklist

- [x] Final copy in English and French
- [ ] Screenshots for the help centre
- [ ] Email to the beta group

| Step | Owner | Due |
| --- | --- | --- |
| Copy | Sam | Friday |
| Review | Alex | Monday |

> Keep the first screen to one question.

\`\`\`ts
const ready = checks.every((check) => check.passed);
\`\`\`
`,
  fr: `# Plan de lancement

Nous livrons le nouvel accueil des comptes **lundi**. La liste ci-dessous suit ce qu’il reste à faire.

## Liste de contrôle

- [x] Textes définitifs en anglais et en français
- [ ] Captures d’écran pour le centre d’aide
- [ ] E-mail au groupe de testeurs de la version beta

| Étape | Responsable | Échéance |
| --- | --- | --- |
| Textes | Sam | Vendredi |
| Relecture | Alex | Lundi |

> Le premier écran ne pose qu’une seule question.

\`\`\`ts
const ready = checks.every((check) => check.passed);
\`\`\`
`,
};

/** A markdown document body with headings, a task list, a table, a quote and code. */
export function fixtureMarkdown(lang: SpecimenLang = 'en'): string {
  return MARKDOWN[lang];
}
