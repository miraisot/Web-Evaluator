// JU — Web Development Practical (HTML5 / semantic markup / accessibility).
//
// Three separate questions, 100 marks in total (Q1 30 + Q2 30 + Q3 40), 2 hrs.
// Each question is its own HTML project so it can be assigned and graded on
// its own. The live preview always renders `index.html`, so students write
// the page in `index.html` (it stands in for request.html / books.html /
// register.html named in the paper).

import type { FileMap } from '../lib/types'

export interface JuTemplate {
  id: string
  title: string
  description: string
  starter_files: FileMap
}

const INSTRUCTIONS = `**Instructions:** Choose the correct tags and attributes yourself. Write the page in \`index.html\` (it stands in for the file name given in the question). Each question carries **10 marks for Code Cleanliness** (consistent indentation, meaningful structure, no unused or duplicated code).`

const BLANK_HTML = (hint: string) => `<!-- ${hint} -->\n`

// ─────────────────────────────────────────────────────────────────────────────
// JU-Q1 — Book Request Page (30 min, 30 marks)
// ─────────────────────────────────────────────────────────────────────────────

const DESC_Q1 = `# JU-Q1 — Book Request Page

**Time:** 30 min · **Marks:** 30 · **File:** \`request.html\` (write it in \`index.html\`)

${INSTRUCTIONS}

Create a page for a **city library**.

| Step | Task | Marks |
|---|---|---|
| 1 | Make a valid HTML5 page. Set the page language and give the page a suitable title. | 2 |
| 2 | Add a top section with the library name and a navigation of three links: **Home, Books, Contact**. Show the links as a list. One link must open an external website in a new tab. | 4 |
| 3 | Add a book request form with: full name, email, book category (choose from 3 options), preferred format (only one of **Print** or **E-book**), a message box, and **Submit** and **Reset** buttons. Every field must be properly connected to its label. | 8 |
| 4 | Without using JavaScript, make name and email compulsory, and make sure the email field only accepts an email address. | 4 |
| 5 | Add a bottom section with a copyright line. | 2 |
| 6 | Code Cleanliness | 10 |
| | **Total** | **30** |
`

// ─────────────────────────────────────────────────────────────────────────────
// JU-Q2 — Available Books Page (30 min, 30 marks)
// ─────────────────────────────────────────────────────────────────────────────

const DESC_Q2 = `# JU-Q2 — Available Books Page

**Time:** 30 min · **Marks:** 30 · **File:** \`books.html\` (write it in \`index.html\`)

${INSTRUCTIONS}

| Step | Task | Marks |
|---|---|---|
| 1 | Use meaningful page-structure elements for the header, main content and footer. Do **not** use plain generic containers for these. | 1 |
| 2 | Add a main heading, one introductory paragraph and one sub-heading, with a correct heading order. | 1 |
| 3 | Add a **numbered list** of the 3 most borrowed books, and a **bulleted list** of 3 book categories. One category must have a **nested list** of 2 sub-categories. | 6 |
| 4 | Show 4 books in a table with columns **Title, Author, Copies**. Give the table a caption and mark the heading cells properly. | 6 |
| 5 | Add a last row where one cell spans 2 columns with the text "Total Copies" and the last cell holds the total. | 2 |
| 6 | Add SEO basics: character encoding, mobile viewport, a meta description (under 160 characters), and a meaningful title. | 4 |
| 7 | Code Cleanliness | 10 |
| | **Total** | **30** |
`

// ─────────────────────────────────────────────────────────────────────────────
// JU-Q3 — College Fest Registration Page (30 min, 40 marks)
// ─────────────────────────────────────────────────────────────────────────────

const DESC_Q3 = `# JU-Q3 — College Fest Registration Page

**Time:** 30 min · **Marks:** 40 · **Files:** \`register.html\` (write it in \`index.html\`) and \`style.css\`

${INSTRUCTIONS}

| Step | Task | Marks |
|---|---|---|
| 1 | Add a link at the very top of the page that lets keyboard users jump straight to the main content. | 2 |
| 2 | Build the page with meaningful page-structure elements: top section, navigation, main content and footer. Show the 3 navigation links as a list. Give the navigation an accessible name using \`aria-label="Main menu"\`. | 6 |
| 3 | Add a list that pairs 3 event names with their venues (a term and its description for each). | 6 |
| 4 | Add a form with name, email and "Participation type" (**Solo** or **Team**, as radio buttons). All fields must have labels. Give the form an accessible name using \`aria-label="Registration form"\`. Group the two radio buttons under the heading "Participation type" so that screen readers announce them as one group. | 6 |
| 5 | Under the email field, add the hint "We will send your pass here" and connect it to the email field using \`aria-describedby\`. Mark name and email as required using \`aria-required="true"\`. | 6 |
| 6 | Add an empty \`<div>\` for error messages and give it \`role="alert"\` so that screen readers announce a message when it appears. | 2 |
| 7 | Link an external stylesheet. Set the page font, background and text colour, and a visible style for when a link or field is focused with the keyboard. | 2 |
| 8 | Code Cleanliness | 10 |
| | **Total** | **40** |
`

export const JU_TEMPLATES: JuTemplate[] = [
  {
    id: 'ju-q1',
    title: 'JU-Q1 · Book Request Page',
    description: DESC_Q1,
    starter_files: {
      'index.html': BLANK_HTML('JU-Q1 — request.html: write your page here'),
      'styles.css': '',
      'script.js': '',
    },
  },
  {
    id: 'ju-q2',
    title: 'JU-Q2 · Available Books Page',
    description: DESC_Q2,
    starter_files: {
      'index.html': BLANK_HTML('JU-Q2 — books.html: write your page here'),
      'styles.css': '',
      'script.js': '',
    },
  },
  {
    id: 'ju-q3',
    title: 'JU-Q3 · College Fest Registration Page',
    description: DESC_Q3,
    starter_files: {
      'index.html': BLANK_HTML('JU-Q3 — register.html: write your page here, and link style.css'),
      'style.css': '',
    },
  },
]
