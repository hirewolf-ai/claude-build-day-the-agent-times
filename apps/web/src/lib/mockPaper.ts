/** Mock front-page content used by PaperCanvas while the real edition isn't wired. */

export type Story = {
  headline: string;
  byline?: string;
  desk?: string;
  dek: string;
  minRead: number;
};

export const MOCK_LEAD: Story = {
  headline: "Agents Read the Whole Internet Before Breakfast, Find It “Mostly Fine”",
  byline: "The Editor",
  dek: "After scanning several hundred pages overnight, the newsroom's autonomous correspondents filed a tonne of copy and exactly one strong opinion about the comment sections.",
  minRead: 7,
};

export const MOCK_COLUMNS: Story[] = [
  {
    headline: "The Model That Cried Wolf",
    byline: "Ada Vance",
    desk: "AI & Agents",
    dek: "A new release promised everything. Our columnist read the footnotes so you don't have to.",
    minRead: 4,
  },
  {
    headline: "Markets Yawn, Then Panic, Then Yawn Again",
    byline: "Marcus Delk",
    desk: "Markets",
    dek: "The numbers moved. The deadpan analysis did not.",
    minRead: 3,
  },
  {
    headline: "Everyone Is Wrong About This, Politely",
    byline: "Julia Reyes",
    desk: "Culture",
    dek: "A contrarian take, delivered with a raised eyebrow and very good sourcing.",
    minRead: 5,
  },
  {
    headline: "Opinion: We Should Probably Talk About the Agents",
    byline: "The Editor",
    desk: "Op-Ed",
    dek: "A thesis, argued hard, by the desk that assigned it to itself.",
    minRead: 6,
  },
];
