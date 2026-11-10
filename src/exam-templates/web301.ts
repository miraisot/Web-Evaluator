// WEB 301 — Mid-Sem Phase 2 exam templates (P0–P9).
//
// Each template produces a React project with:
//   - a Vite-shaped folder layout (src/App.jsx, src/pages/..., src/components/..., src/data/...)
//   - a fully populated sample dataset (so students can test immediately)
//   - EMPTY component / page shells with TODO markers (students implement these)
//   - a working main.jsx + index.html + package.json
//
// The datasets here are plausible samples. Swap in the official Phase 2
// datasets from the Google Doc before publishing the exam if different.

import type { FileMap } from '../lib/types'

export interface ExamTemplate {
  id: string
  title: string
  description: string
  starter_files: FileMap
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared boilerplate (identical across all 10 problems)
// ─────────────────────────────────────────────────────────────────────────────

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WEB 301 — Mid-Sem Phase 2</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'web301-midsem',
    version: '1.0.0',
    main: '/src/main.jsx',
    dependencies: {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      // The spec says `import ... from "react-router"`; the sandbox aliases
      // that name to react-router-dom (v6) under the hood so the import
      // works, since react-router v7 doesn't bundle inside Sandpack.
      'react-router-dom': '^6.26.0',
    },
  },
  null,
  2,
) + '\n'

const MAIN_JSX = `import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
`

const STYLES_CSS = `* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #222;
  background: #f6f7fb;
}
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
.container { max-width: 980px; margin: 0 auto; padding: 16px; }
.navbar {
  display: flex; gap: 16px; align-items: center;
  padding: 12px 20px; background: #0f172a; color: white;
}
.navbar a { color: #e2e8f0; }
.navbar .spacer { flex: 1; }
.card {
  background: white; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 14px; margin-bottom: 12px;
}
.badge {
  display: inline-block; font-size: 11px; padding: 2px 8px;
  border-radius: 999px; background: #e5e7eb; color: #334155;
  margin-right: 6px;
}
.badge.ok   { background: #dcfce7; color: #166534; }
.badge.warn { background: #fef3c7; color: #92400e; }
.badge.bad  { background: #fee2e2; color: #991b1b; }
button {
  cursor: pointer; padding: 6px 12px; border: 0; border-radius: 6px;
  background: #2563eb; color: white; font: inherit;
}
button:disabled { opacity: .6; cursor: not-allowed; }
button.secondary { background: #475569; }
input, select {
  padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit;
}
`

// ─────────────────────────────────────────────────────────────────────────────
// Per-problem configuration
// ─────────────────────────────────────────────────────────────────────────────

interface ProblemConfig {
  id: string              // 'p0'
  title: string           // human title
  item: string            // 'Book'       (PascalCase singular → <Item>Card)
  itemLower: string       // 'book'
  list: string            // 'Books'      (PascalCase list page name)
  listPath: string        // '/books'
  saved: string           // 'Issued'     (saved page PascalCase)
  savedPath: string       // '/issued'
  savedVerb: string       // 'issued'     (used in action label when empty)
  datasetFile: string     // 'books.js'
  datasetExport: string   // 'books'
  dataset: string         // RAW JS source for src/data/<file>.js
  description: string     // markdown problem statement
}

// Keep App.jsx minimal — route scaffold with TODO markers. Students fill in
// state, handlers, and prop plumbing.
const appJsx = (c: ProblemConfig) => `import { Routes, Route } from 'react-router'
import { useState } from 'react'
import { ${c.datasetExport} as initial${c.list} } from './data/${c.datasetFile.replace(/\.js$/, '')}'
import Navbar from './components/Navbar.jsx'
import Home from './pages/Home.jsx'
import ${c.list} from './pages/${c.list}.jsx'
import ${c.item}Details from './pages/${c.item}Details.jsx'
import ${c.saved} from './pages/${c.saved}.jsx'

export default function App() {
  const [${c.datasetExport}, set${c.list}] = useState(initial${c.list})

  // TODO: implement the toggle / action function described in the problem
  // statement and pass it to the pages that need it.

  return (
    <>
      <Navbar ${c.datasetExport}={${c.datasetExport}} />
      <div className="container">
        <Routes>
          <Route path="/" element={<Home ${c.datasetExport}={${c.datasetExport}} />} />
          <Route path="${c.listPath}" element={<${c.list} ${c.datasetExport}={${c.datasetExport}} />} />
          <Route path="${c.listPath}/:id" element={<${c.item}Details ${c.datasetExport}={${c.datasetExport}} />} />
          <Route path="${c.savedPath}" element={<${c.saved} ${c.datasetExport}={${c.datasetExport}} />} />
          <Route path="*" element={<h2>Not Found</h2>} />
        </Routes>
      </div>
    </>
  )
}
`

const navbarJsx = (c: ProblemConfig) => `import { Link } from 'react-router'

export default function Navbar({ ${c.datasetExport} }) {
  // TODO: compute the live "saved" count from props and show it.
  return (
    <nav className="navbar">
      <strong>WEB 301</strong>
      <Link to="/">Home</Link>
      <Link to="${c.listPath}">${c.list}</Link>
      <Link to="${c.savedPath}">${c.saved}</Link>
      <span className="spacer" />
      {/* <span>${c.saved}: {count}</span> */}
    </nav>
  )
}
`

const cardJsx = (c: ProblemConfig) => `// Reusable ${c.item}Card — displayed on the list page.
// Props: ${c.itemLower} object + any action functions you pass from App.

export default function ${c.item}Card({ ${c.itemLower} /*, onAction */ }) {
  // TODO: render the fields required by the problem statement,
  // the badge(s), and the action button with its special-rule text.
  return (
    <div className="card">
      <h3>{${c.itemLower}.name || ${c.itemLower}.title}</h3>
      {/* TODO: badges, details, action button */}
    </div>
  )
}
`

const homeJsx = (c: ProblemConfig) => `export default function Home({ ${c.datasetExport} }) {
  // TODO: compute the summary counts described in the problem statement.
  return (
    <>
      <h1>WEB 301 — Mid-Sem Phase 2</h1>
      <p>Welcome. Use the navbar to browse ${c.list.toLowerCase()}.</p>
      {/* TODO: summary stats */}
    </>
  )
}
`

const listJsx = (c: ProblemConfig) => `import { useState } from 'react'
import ${c.item}Card from '../components/${c.item}Card.jsx'

export default function ${c.list}({ ${c.datasetExport} /*, actions */ }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')

  // TODO: apply search (name/title contains query) + dropdown filter,
  // then render a <${c.item}Card /> for each matching item.
  const visible = ${c.datasetExport}

  return (
    <>
      <h2>${c.list}</h2>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0 16px' }}>
        <input
          placeholder="Search…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option>All</option>
          {/* TODO: fill the dropdown options described in the problem statement */}
        </select>
      </div>
      {visible.length === 0 && <p>No matches.</p>}
      {visible.map(item => (
        <${c.item}Card key={item.id} ${c.itemLower}={item} />
      ))}
    </>
  )
}
`

const detailsJsx = (c: ProblemConfig) => `import { useParams, Link } from 'react-router'

export default function ${c.item}Details({ ${c.datasetExport} /*, actions */ }) {
  const { id } = useParams()
  const item = ${c.datasetExport}.find(x => String(x.id) === id)

  if (!item) {
    return (
      <>
        <p>${c.item} not found.</p>
        <Link to="${c.listPath}">← Back to ${c.list.toLowerCase()}</Link>
      </>
    )
  }

  // TODO: show all fields required by the problem statement.
  return (
    <>
      <Link to="${c.listPath}">← Back</Link>
      <h2>{item.name || item.title}</h2>
      <pre style={{ background: '#f1f5f9', padding: 12, borderRadius: 8 }}>
        {JSON.stringify(item, null, 2)}
      </pre>
    </>
  )
}
`

const savedJsx = (c: ProblemConfig) => `export default function ${c.saved}({ ${c.datasetExport} }) {
  // TODO: filter to only the ${c.savedVerb} items and render them.
  // If none, show the empty-state message from the problem statement.
  return (
    <>
      <h2>${c.saved}</h2>
      <p>(implement me)</p>
    </>
  )
}
`

function buildStarter(c: ProblemConfig): FileMap {
  return {
    'index.html': INDEX_HTML,
    'package.json': PACKAGE_JSON,
    'src/main.jsx': MAIN_JSX,
    'src/styles.css': STYLES_CSS,
    'src/App.jsx': appJsx(c),
    'src/components/Navbar.jsx': navbarJsx(c),
    [`src/components/${c.item}Card.jsx`]: cardJsx(c),
    'src/pages/Home.jsx': homeJsx(c),
    [`src/pages/${c.list}.jsx`]: listJsx(c),
    [`src/pages/${c.item}Details.jsx`]: detailsJsx(c),
    [`src/pages/${c.saved}.jsx`]: savedJsx(c),
    [`src/data/${c.datasetFile}`]: c.dataset,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Datasets (sample data — swap for official datasets before publishing)
// ─────────────────────────────────────────────────────────────────────────────

const BOOKS_JS = `export const books = [
  { id: 1, title: 'The Pragmatic Programmer', author: 'Andy Hunt', genre: 'Technology', year: 1999, pages: 320, totalCopies: 4, availableCopies: 2, isIssued: false },
  { id: 2, title: 'Clean Code', author: 'Robert C. Martin', genre: 'Technology', year: 2008, pages: 464, totalCopies: 5, availableCopies: 0, isIssued: false },
  { id: 3, title: 'Atomic Habits', author: 'James Clear', genre: 'Self-Help', year: 2018, pages: 320, totalCopies: 6, availableCopies: 4, isIssued: false },
  { id: 4, title: 'Sapiens', author: 'Yuval Noah Harari', genre: 'Biography', year: 2011, pages: 464, totalCopies: 3, availableCopies: 1, isIssued: false },
  { id: 5, title: 'Deep Work', author: 'Cal Newport', genre: 'Self-Help', year: 2016, pages: 304, totalCopies: 4, availableCopies: 3, isIssued: false },
  { id: 6, title: 'Dune', author: 'Frank Herbert', genre: 'Fiction', year: 1965, pages: 688, totalCopies: 3, availableCopies: 2, isIssued: false },
  { id: 7, title: 'The Alchemist', author: 'Paulo Coelho', genre: 'Fiction', year: 1988, pages: 208, totalCopies: 5, availableCopies: 5, isIssued: false },
  { id: 8, title: 'Steve Jobs', author: 'Walter Isaacson', genre: 'Biography', year: 2011, pages: 656, totalCopies: 2, availableCopies: 0, isIssued: false },
  { id: 9, title: 'Eloquent JavaScript', author: 'Marijn Haverbeke', genre: 'Technology', year: 2018, pages: 472, totalCopies: 4, availableCopies: 2, isIssued: false },
  { id: 10, title: 'Mindset', author: 'Carol S. Dweck', genre: 'Self-Help', year: 2006, pages: 288, totalCopies: 3, availableCopies: 1, isIssued: false },
]
`

const ROOMS_JS = `export const rooms = [
  { id: 1, roomNumber: 'A-101', block: 'A', type: 'AC',     rentPerMonth: 8500, capacity: 2, occupied: 1, floor: 1, facilities: ['Study table', 'Wardrobe', 'Attached bath'], isBooked: false },
  { id: 2, roomNumber: 'A-102', block: 'A', type: 'Non-AC', rentPerMonth: 6500, capacity: 3, occupied: 3, floor: 1, facilities: ['Study table', 'Wardrobe'],                   isBooked: false },
  { id: 3, roomNumber: 'B-201', block: 'B', type: 'AC',     rentPerMonth: 9000, capacity: 2, occupied: 0, floor: 2, facilities: ['Study table', 'Wardrobe', 'Balcony'],         isBooked: false },
  { id: 4, roomNumber: 'B-205', block: 'B', type: 'Non-AC', rentPerMonth: 6000, capacity: 4, occupied: 2, floor: 2, facilities: ['Study table', 'Wardrobe'],                   isBooked: false },
  { id: 5, roomNumber: 'C-301', block: 'C', type: 'AC',     rentPerMonth: 8800, capacity: 2, occupied: 2, floor: 3, facilities: ['Study table', 'Wardrobe', 'Balcony'],         isBooked: false },
  { id: 6, roomNumber: 'C-302', block: 'C', type: 'Non-AC', rentPerMonth: 5800, capacity: 3, occupied: 1, floor: 3, facilities: ['Study table'],                                isBooked: false },
  { id: 7, roomNumber: 'D-110', block: 'D', type: 'AC',     rentPerMonth: 9500, capacity: 1, occupied: 0, floor: 1, facilities: ['Study table', 'Wardrobe', 'Attached bath'], isBooked: false },
  { id: 8, roomNumber: 'D-220', block: 'D', type: 'Non-AC', rentPerMonth: 6200, capacity: 4, occupied: 4, floor: 2, facilities: ['Study table', 'Wardrobe'],                   isBooked: false },
]
`

const EVENTS_JS = `export const events = [
  { id: 1, name: 'Hackathon 24h',   category: 'Technical', date: '2026-11-05', fee: 300,  totalSeats: 50, registered: 42, venue: 'CS Lab 1', coordinator: 'Prof. Rao',    isRegistered: false },
  { id: 2, name: 'Battle of Bands', category: 'Cultural',  date: '2026-11-08', fee: 100,  totalSeats: 200, registered: 150, venue: 'Open Air Theatre', coordinator: 'Riya K.',    isRegistered: false },
  { id: 3, name: 'Cricket League',  category: 'Sports',    date: '2026-11-10', fee: 0,    totalSeats: 100, registered: 100, venue: 'Main Ground', coordinator: 'Coach Singh', isRegistered: false },
  { id: 4, name: 'Robotics Expo',   category: 'Technical', date: '2026-11-12', fee: 150,  totalSeats: 80, registered: 76, venue: 'ECE Block',   coordinator: 'Prof. Mehra',   isRegistered: false },
  { id: 5, name: 'Dance Night',     category: 'Cultural',  date: '2026-11-15', fee: 200,  totalSeats: 150, registered: 100, venue: 'Auditorium', coordinator: 'Aarav M.',   isRegistered: false },
  { id: 6, name: 'Chess Open',      category: 'Sports',    date: '2026-11-16', fee: 50,   totalSeats: 60, registered: 20, venue: 'Library Hall', coordinator: 'Mr. Verma',  isRegistered: false },
  { id: 7, name: 'AI Workshop',     category: 'Technical', date: '2026-11-18', fee: 0,    totalSeats: 40, registered: 36, venue: 'CS Lab 2', coordinator: 'Prof. Rao',      isRegistered: false },
  { id: 8, name: 'Fashion Show',    category: 'Cultural',  date: '2026-11-20', fee: 250,  totalSeats: 180, registered: 90, venue: 'Auditorium', coordinator: 'Isha P.',    isRegistered: false },
]
`

const RECIPES_JS = `export const recipes = [
  { id: 1, emoji: '🍝', name: 'Spaghetti Aglio e Olio', cuisine: 'Italian', cookingTime: 20, difficulty: 'Easy',   type: 'Veg',     ingredients: ['Spaghetti', 'Garlic', 'Olive oil', 'Chili flakes', 'Parsley'],         isFavourite: false },
  { id: 2, emoji: '🍜', name: 'Chicken Ramen',           cuisine: 'Japanese', cookingTime: 45, difficulty: 'Medium', type: 'Non-Veg', ingredients: ['Ramen', 'Chicken', 'Soy sauce', 'Egg', 'Scallions'],                   isFavourite: false },
  { id: 3, emoji: '🥗', name: 'Caesar Salad',            cuisine: 'American', cookingTime: 15, difficulty: 'Easy',   type: 'Veg',     ingredients: ['Romaine', 'Croutons', 'Parmesan', 'Caesar dressing'],                  isFavourite: false },
  { id: 4, emoji: '🍛', name: 'Butter Chicken',          cuisine: 'Indian',   cookingTime: 50, difficulty: 'Medium', type: 'Non-Veg', ingredients: ['Chicken', 'Butter', 'Tomato', 'Cream', 'Garam masala'],                isFavourite: false },
  { id: 5, emoji: '🥘', name: 'Paneer Tikka',            cuisine: 'Indian',   cookingTime: 25, difficulty: 'Easy',   type: 'Veg',     ingredients: ['Paneer', 'Yoghurt', 'Spices', 'Capsicum', 'Onion'],                     isFavourite: false },
  { id: 6, emoji: '🍲', name: 'Tom Yum Soup',            cuisine: 'Thai',     cookingTime: 30, difficulty: 'Medium', type: 'Non-Veg', ingredients: ['Prawns', 'Lemongrass', 'Lime leaves', 'Chili', 'Mushroom'],            isFavourite: false },
  { id: 7, emoji: '🫓', name: 'Masala Dosa',             cuisine: 'Indian',   cookingTime: 40, difficulty: 'Medium', type: 'Veg',     ingredients: ['Rice batter', 'Potato', 'Mustard seeds', 'Curry leaves'],              isFavourite: false },
  { id: 8, emoji: '🍔', name: 'Classic Burger',          cuisine: 'American', cookingTime: 20, difficulty: 'Easy',   type: 'Non-Veg', ingredients: ['Beef patty', 'Bun', 'Lettuce', 'Cheese', 'Pickles'],                   isFavourite: false },
  { id: 9, emoji: '🍕', name: 'Margherita Pizza',        cuisine: 'Italian',  cookingTime: 35, difficulty: 'Medium', type: 'Veg',     ingredients: ['Pizza dough', 'Tomato', 'Mozzarella', 'Basil'],                        isFavourite: false },
  { id: 10, emoji: '🍣', name: 'Salmon Sushi',           cuisine: 'Japanese', cookingTime: 60, difficulty: 'Hard',   type: 'Non-Veg', ingredients: ['Sushi rice', 'Salmon', 'Nori', 'Wasabi'],                              isFavourite: false },
]
`

const DOCTORS_JS = `export const doctors = [
  { id: 1, name: 'Dr. Ramesh Iyer',  specialization: 'Cardiologist',  experience: 15, fee: 800, rating: 4.7, isAvailableToday: true,  availableSlots: 3, hospital: 'Apollo',   isBooked: false },
  { id: 2, name: 'Dr. Neha Verma',   specialization: 'Dermatologist', experience: 7,  fee: 600, rating: 4.5, isAvailableToday: true,  availableSlots: 0, hospital: 'Fortis',   isBooked: false },
  { id: 3, name: 'Dr. Arjun Mehta',  specialization: 'Orthopedic',    experience: 12, fee: 900, rating: 4.6, isAvailableToday: false, availableSlots: 5, hospital: 'Max',      isBooked: false },
  { id: 4, name: 'Dr. Priya Nair',   specialization: 'Pediatrician',  experience: 9,  fee: 500, rating: 4.8, isAvailableToday: true,  availableSlots: 4, hospital: 'Rainbow',  isBooked: false },
  { id: 5, name: 'Dr. Sanjay Shah',  specialization: 'Dentist',       experience: 20, fee: 700, rating: 4.9, isAvailableToday: true,  availableSlots: 2, hospital: 'SmileCare',isBooked: false },
  { id: 6, name: 'Dr. Kavita Rao',   specialization: 'Cardiologist',  experience: 5,  fee: 700, rating: 4.3, isAvailableToday: false, availableSlots: 1, hospital: 'Apollo',   isBooked: false },
  { id: 7, name: 'Dr. Imran Khan',   specialization: 'Dermatologist', experience: 11, fee: 650, rating: 4.4, isAvailableToday: true,  availableSlots: 3, hospital: 'Max',      isBooked: false },
  { id: 8, name: 'Dr. Lata Deshmukh',specialization: 'Pediatrician',  experience: 18, fee: 550, rating: 4.9, isAvailableToday: true,  availableSlots: 0, hospital: 'Rainbow',  isBooked: false },
]
`

const JOBS_JS = `export const jobs = [
  { id: 1, title: 'Frontend Engineer',  company: 'Flipkart',    location: 'Bengaluru', mode: 'Hybrid', packageLPA: 18, experienceRequired: 2, openings: 5, skills: ['React', 'TypeScript', 'CSS'],              isApplied: false },
  { id: 2, title: 'Backend Developer',  company: 'Razorpay',    location: 'Bengaluru', mode: 'Remote', packageLPA: 20, experienceRequired: 3, openings: 3, skills: ['Node', 'Postgres', 'AWS'],                  isApplied: false },
  { id: 3, title: 'Data Analyst',       company: 'Swiggy',      location: 'Hyderabad', mode: 'Onsite', packageLPA: 12, experienceRequired: 0, openings: 4, skills: ['SQL', 'Python', 'PowerBI'],                 isApplied: false },
  { id: 4, title: 'Mobile Engineer',    company: 'Zomato',      location: 'Gurgaon',   mode: 'Hybrid', packageLPA: 16, experienceRequired: 2, openings: 0, skills: ['React Native', 'Swift'],                    isApplied: false },
  { id: 5, title: 'DevOps Engineer',    company: 'Freshworks',  location: 'Chennai',   mode: 'Remote', packageLPA: 22, experienceRequired: 4, openings: 2, skills: ['Docker', 'Kubernetes', 'Terraform'],        isApplied: false },
  { id: 6, title: 'UI/UX Designer',     company: 'CRED',        location: 'Bengaluru', mode: 'Onsite', packageLPA: 14, experienceRequired: 1, openings: 2, skills: ['Figma', 'Research'],                        isApplied: false },
  { id: 7, title: 'ML Intern',          company: 'Myntra',      location: 'Bengaluru', mode: 'Onsite', packageLPA: 6,  experienceRequired: 0, openings: 6, skills: ['Python', 'PyTorch'],                        isApplied: false },
  { id: 8, title: 'SDE-1',              company: 'Paytm',       location: 'Noida',     mode: 'Hybrid', packageLPA: 15, experienceRequired: 0, openings: 8, skills: ['Java', 'DSA'],                              isApplied: false },
]
`

const SONGS_JS = `export const songs = [
  { id: 1, title: 'Tum Hi Ho',       artist: 'Arijit Singh',  genre: 'Romantic',     duration: 262, streams: 2500000, album: 'Aashiqui 2', year: 2013, isInPlaylist: false },
  { id: 2, title: 'Zinda',           artist: 'Siddharth M.',  genre: 'Motivational', duration: 212, streams: 1200000, album: 'Bhaag Milkha Bhaag', year: 2013, isInPlaylist: false },
  { id: 3, title: 'Tajdar-e-Haram',  artist: 'Atif Aslam',    genre: 'Sufi',         duration: 606, streams: 900000,  album: 'Coke Studio', year: 2015, isInPlaylist: false },
  { id: 4, title: 'Laung Laachi',    artist: 'Mannat Noor',   genre: 'Punjabi',      duration: 268, streams: 3400000, album: 'Laung Laachi', year: 2018, isInPlaylist: false },
  { id: 5, title: 'Agar Tum Saath Ho', artist: 'Arijit Singh',genre: 'Romantic',     duration: 357, streams: 2100000, album: 'Tamasha', year: 2015, isInPlaylist: false },
  { id: 6, title: 'Challa',          artist: 'Rabbi Shergill',genre: 'Sufi',         duration: 325, streams: 450000,  album: 'Rabbi', year: 2004, isInPlaylist: false },
  { id: 7, title: 'Lahore',          artist: 'Guru Randhawa', genre: 'Punjabi',      duration: 203, streams: 1800000, album: 'Single', year: 2017, isInPlaylist: false },
  { id: 8, title: 'Kar Har Maidaan Fateh', artist: 'Sukhwinder Singh', genre: 'Motivational', duration: 290, streams: 700000, album: 'Sanju', year: 2018, isInPlaylist: false },
  { id: 9, title: 'Raataan Lambiyan',artist: 'Jubin Nautiyal',genre: 'Romantic',     duration: 215, streams: 2800000, album: 'Shershaah', year: 2021, isInPlaylist: false },
  { id: 10, title: 'Afreen Afreen',  artist: 'Rahat Fateh Ali Khan', genre: 'Sufi',  duration: 540, streams: 1500000, album: 'Coke Studio', year: 2016, isInPlaylist: false },
]
`

const BIKES_JS = `export const bikes = [
  { id: 1, name: 'Activa 6G',   brand: 'Honda',      type: 'Scooter',  pricePerHour: 60,  location: 'Koramangala',  isAvailable: true,  engineCC: 109, isRented: false },
  { id: 2, name: 'Classic 350', brand: 'Royal Enfield', type: 'Bike',  pricePerHour: 150, location: 'Indiranagar',  isAvailable: true,  engineCC: 349, isRented: false },
  { id: 3, name: 'Chetak',      brand: 'Bajaj',      type: 'Electric', pricePerHour: 80,  location: 'HSR Layout',   isAvailable: true,  engineCC: 0,   isRented: false },
  { id: 4, name: 'Jupiter',     brand: 'TVS',        type: 'Scooter',  pricePerHour: 55,  location: 'Whitefield',   isAvailable: false, engineCC: 110, isRented: false },
  { id: 5, name: 'Pulsar NS200',brand: 'Bajaj',      type: 'Bike',     pricePerHour: 120, location: 'Marathahalli', isAvailable: true,  engineCC: 199, isRented: false },
  { id: 6, name: 'iQube',       brand: 'TVS',        type: 'Electric', pricePerHour: 90,  location: 'JP Nagar',     isAvailable: true,  engineCC: 0,   isRented: false },
  { id: 7, name: 'Duke 390',    brand: 'KTM',        type: 'Bike',     pricePerHour: 180, location: 'MG Road',      isAvailable: false, engineCC: 373, isRented: false },
  { id: 8, name: 'Access 125',  brand: 'Suzuki',     type: 'Scooter',  pricePerHour: 65,  location: 'BTM Layout',   isAvailable: true,  engineCC: 124, isRented: false },
]
`

const PETS_JS = `export const pets = [
  { id: 1, emoji: '🐕', name: 'Bruno',   type: 'Dog',    breed: 'Labrador',       ageMonths: 24, isVaccinated: true,  adoptionFee: 2000, gender: 'Male',   isAdopted: false },
  { id: 2, emoji: '🐈', name: 'Milo',    type: 'Cat',    breed: 'Persian',        ageMonths: 10, isVaccinated: true,  adoptionFee: 1500, gender: 'Male',   isAdopted: false },
  { id: 3, emoji: '🐇', name: 'Snowy',   type: 'Rabbit', breed: 'Angora',         ageMonths: 6,  isVaccinated: false, adoptionFee: 0,    gender: 'Female', isAdopted: false },
  { id: 4, emoji: '🐦', name: 'Kiwi',    type: 'Bird',   breed: 'Budgerigar',     ageMonths: 8,  isVaccinated: true,  adoptionFee: 500,  gender: 'Male',   isAdopted: false },
  { id: 5, emoji: '🐕', name: 'Luna',    type: 'Dog',    breed: 'Beagle',         ageMonths: 36, isVaccinated: true,  adoptionFee: 1800, gender: 'Female', isAdopted: false },
  { id: 6, emoji: '🐈', name: 'Simba',   type: 'Cat',    breed: 'Siamese',        ageMonths: 14, isVaccinated: false, adoptionFee: 0,    gender: 'Male',   isAdopted: false },
  { id: 7, emoji: '🐇', name: 'Thumper', type: 'Rabbit', breed: 'Lop',            ageMonths: 18, isVaccinated: true,  adoptionFee: 700,  gender: 'Male',   isAdopted: false },
  { id: 8, emoji: '🐦', name: 'Rio',     type: 'Bird',   breed: 'Macaw',          ageMonths: 30, isVaccinated: true,  adoptionFee: 3000, gender: 'Female', isAdopted: false },
  { id: 9, emoji: '🐕', name: 'Rocky',   type: 'Dog',    breed: 'German Shepherd',ageMonths: 11, isVaccinated: true,  adoptionFee: 2500, gender: 'Male',   isAdopted: false },
  { id: 10, emoji: '🐈', name: 'Coco',   type: 'Cat',    breed: 'Bengal',         ageMonths: 5,  isVaccinated: false, adoptionFee: 0,    gender: 'Female', isAdopted: false },
]
`

const COMPANIES_JS = `export const myProfile = { name: 'You', branch: 'CSE', cgpa: 7.5 }

export const companies = [
  { id: 1, name: 'Google',    role: 'SWE Intern',       packageLPA: 25, location: 'Bengaluru', driveDate: '2026-11-10', minCGPA: 8.0, eligibleBranches: ['CSE', 'IT'],                 isApplied: false },
  { id: 2, name: 'Microsoft', role: 'SDE-1',            packageLPA: 22, location: 'Hyderabad', driveDate: '2026-11-12', minCGPA: 7.5, eligibleBranches: ['CSE', 'IT', 'ECE'],         isApplied: false },
  { id: 3, name: 'Infosys',   role: 'Systems Engineer', packageLPA: 6,  location: 'Mysuru',    driveDate: '2026-11-14', minCGPA: 6.5, eligibleBranches: ['CSE', 'IT', 'ECE', 'EEE', 'MECH'], isApplied: false },
  { id: 4, name: 'Goldman Sachs', role: 'Analyst',      packageLPA: 18, location: 'Bengaluru', driveDate: '2026-11-15', minCGPA: 8.5, eligibleBranches: ['CSE', 'IT'],                 isApplied: false },
  { id: 5, name: 'TCS',       role: 'Digital',          packageLPA: 7,  location: 'Mumbai',    driveDate: '2026-11-16', minCGPA: 7.0, eligibleBranches: ['CSE', 'IT', 'ECE', 'EEE'],  isApplied: false },
  { id: 6, name: 'Amazon',    role: 'SDE-1',            packageLPA: 24, location: 'Bengaluru', driveDate: '2026-11-18', minCGPA: 7.5, eligibleBranches: ['CSE', 'IT'],                 isApplied: false },
  { id: 7, name: 'Deloitte',  role: 'Consultant',       packageLPA: 9,  location: 'Gurgaon',   driveDate: '2026-11-20', minCGPA: 7.0, eligibleBranches: ['CSE', 'IT', 'MECH'],         isApplied: false },
  { id: 8, name: 'Qualcomm',  role: 'Hardware Engineer',packageLPA: 20, location: 'Hyderabad', driveDate: '2026-11-22', minCGPA: 8.0, eligibleBranches: ['ECE', 'EEE'],                isApplied: false },
]
`

// ─────────────────────────────────────────────────────────────────────────────
// Problem statements (markdown) — one per problem
// ─────────────────────────────────────────────────────────────────────────────

const DESC_P0 = `# P0 — Library Book Manager

**File:** \`books.js\` · **Routes:** \`/\` · \`/books\` · \`/books/:id\` · \`/issued\`

Create a reusable \`BookCard\` showing **title**, **author**, **genre** and **available copies**.

- **Badge:** \`Available\` if \`availableCopies > 0\`, otherwise \`Not Available\`.
- **Issue** button → \`isIssued: true\` and \`availableCopies − 1\`. **Return** button → \`isIssued: false\` and \`availableCopies + 1\`.
- If a book is **not issued** and \`availableCopies\` is \`0\`, show "Not Available" text instead of the button.
- **Dropdown filter:** genre (All, Biography, Fiction, Technology, Self-Help).
- **Details page** also shows **year**, **pages** and **total copies**.
- **Home** shows total books, issued books and not-available books.
- **/issued** shows only issued books, or "No books issued yet".
`

const DESC_P1 = `# P1 — Hostel Room Booking

**File:** \`rooms.js\` · **Routes:** \`/\` · \`/rooms\` · \`/rooms/:id\` · \`/my-booking\`

Create a reusable \`RoomCard\` showing **room number**, **block**, **type**, **rent per month** and **beds left** (\`capacity − occupied\`).

- **Badge:** \`Full\` if \`occupied === capacity\`, otherwise \`N beds left\`.
- **Book** button → \`isBooked: true\` and \`occupied + 1\`. **Cancel** button → \`isBooked: false\` and \`occupied − 1\`.
- **Special rule:** only one room can be booked at a time. While a room is booked, every other room shows "Already booked another room" instead of the Book button. A full room shows "Room Full".
- **Dropdown filter:** type (All, AC, Non-AC).
- **Details page** also shows **floor** and the **facilities** list using \`map()\`.
- **Home** shows total rooms, rooms with beds left, and your booked room number (or "No booking yet").
- **/my-booking** shows the booked room with its monthly rent, or "You have not booked any room".
`

const DESC_P2 = `# P2 — College Fest Events

**File:** \`events.js\` · **Routes:** \`/\` · \`/events\` · \`/events/:id\` · \`/registered\`

Create a reusable \`EventCard\` showing **name**, **category**, **date**, **fee** and **seats left** (\`totalSeats − registered\`).

- Show \`Free\` if \`fee\` is \`0\`, otherwise \`₹fee\`.
- **Register** button → \`isRegistered: true\` and \`registered + 1\`. **Unregister** button → \`isRegistered: false\` and \`registered − 1\`.
- If seats left is \`0\` and you are not registered, show "Housefull" instead of the button. Show a \`Filling Fast\` badge when seats left is between \`1\` and \`5\`.
- **Dropdown filter:** category (All, Technical, Cultural, Sports).
- **Details page** also shows **venue**, **coordinator**, **total seats** and **registered count**.
- **Home** shows total events, your registered events and free events.
- **/registered** shows your registered events and the total fee to pay, or "No events registered".
`

const DESC_P3 = `# P3 — Recipe Book

**File:** \`recipes.js\` · **Routes:** \`/\` · \`/recipes\` · \`/recipes/:id\` · \`/favourites\`

Create a reusable \`RecipeCard\` showing **emoji**, **name**, **cuisine**, **cooking time (min)** and **difficulty**.

- **Badge:** \`Veg\` (green) or \`Non-Veg\` (red) from \`type\`. Extra badge \`Quick\` if \`cookingTime <= 20\`.
- **Toggle button:** "♡ Add to Favourites" ↔ "❤ Remove from Favourites" (\`isFavourite\`).
- **Dropdown filter:** type (All, Veg, Non-Veg).
- **Special rule:** add a second dropdown to sort by cooking time (Low → High, High → Low). Sort a copy (\`[...list].sort()\`), never the state array.
- **Details page** shows the **ingredients** list using \`map()\` and the text "N ingredients".
- **Home** shows total recipes, veg recipes and favourite recipes.
- **/favourites** shows favourite recipes and their total cooking time, or "No favourites yet".
`

const DESC_P4 = `# P4 — Doctor Appointment

**File:** \`doctors.js\` · **Routes:** \`/\` · \`/doctors\` · \`/doctors/:id\` · \`/appointments\`

Create a reusable \`DoctorCard\` showing **name**, **specialization**, **experience**, **fee** and **rating**.

- **Badge:** \`Available Today\` if \`isAvailableToday\` is true and \`availableSlots > 0\`, otherwise \`Not Available\`. Extra badge \`Senior Doctor\` if \`experience >= 10\`.
- **Book Appointment** button → \`isBooked: true\` and \`availableSlots − 1\`. **Cancel** button → \`isBooked: false\` and \`availableSlots + 1\`.
- **Special rule:** show "Not Available Today" when \`isAvailableToday\` is false, and "No Slots Left" when slots are 0 — instead of the Book button.
- **Dropdown filter:** specialization (All, Cardiologist, Dermatologist, Orthopedic, Pediatrician, Dentist).
- **Details page** also shows **hospital** and **available slots**.
- **Home** shows total doctors, doctors available today and booked appointments.
- **/appointments** shows booked doctors and the total consultation fee, or "No appointments booked".
`

const DESC_P5 = `# P5 — Job Portal

**File:** \`jobs.js\` · **Routes:** \`/\` · \`/jobs\` · \`/jobs/:id\` · \`/applied\`

Create a reusable \`JobCard\` showing **title**, **company**, **location**, **mode** and **package (LPA)**.

- **Badge:** \`Fresher Friendly\` if \`experienceRequired === 0\`, otherwise \`N yrs exp\`.
- **Apply** button → \`isApplied: true\`. **Withdraw** button → \`isApplied: false\`.
- If \`openings\` is \`0\`, show "Hiring Closed" instead of the Apply button.
- **Special rule:** maximum 3 applications. When 3 jobs are applied, other jobs show "Limit reached (3/3)" instead of Apply, and the list page shows a warning at the top.
- **Dropdown filter:** mode (All, Remote, Onsite, Hybrid).
- **Details page** also shows **openings**, **experience required** and the **skills** list using \`map()\`.
- **Home** shows total jobs, applied jobs and remote jobs. **/applied** shows applied jobs and "Applications used: N/3", or "No applications yet".
`

const DESC_P6 = `# P6 — Music Playlist

**File:** \`songs.js\` · **Routes:** \`/\` · \`/songs\` · \`/songs/:id\` · \`/playlist\`

Create a reusable \`SongCard\` showing **title**, **artist**, **genre** and **duration**.

- **Special rule:** duration is in seconds — display it as \`m:ss\` (\`268 → 4:28\`) using a small helper function.
- **Badge:** \`Trending 🔥\` if \`streams >= 1000000\`.
- **Toggle button:** "Add to Playlist" ↔ "Remove from Playlist" (\`isInPlaylist\`).
- **Dropdown filter:** genre (All, Romantic, Motivational, Sufi, Punjabi).
- **Details page** also shows **album**, **year** and **streams**.
- **Home** shows total songs, songs in playlist and trending songs.
- **/playlist** shows playlist songs and their total duration in \`m:ss\`, or "Your playlist is empty".
`

const DESC_P7 = `# P7 — Bike Rental

**File:** \`bikes.js\` · **Routes:** \`/\` · \`/bikes\` · \`/bikes/:id\` · \`/rented\`

Create a reusable \`BikeCard\` showing **name**, **brand**, **type**, **price per hour** and **location**.

- **Badge:** \`Available\` if \`isAvailable\` is true, otherwise \`Under Maintenance\`.
- **Rent** button → \`isRented: true\`. **Return** button → \`isRented: false\`. A bike under maintenance shows "Under Maintenance" text instead of the button.
- Show engine as \`Electric ⚡\` when \`engineCC\` is \`0\`, otherwise \`N cc\`.
- **Special rule:** the Details page has an hours counter (\`− / +\`) with its own \`useState\`, from \`1\` to \`12\` hours, and shows \`Total Rent = pricePerHour × hours\`.
- **Dropdown filter:** type (All, Scooter, Bike, Electric).
- **Home** shows total bikes, available bikes and rented bikes.
- **/rented** shows rented bikes and the total of their price per hour, or "No bikes rented".
`

const DESC_P8 = `# P8 — Pet Adoption

**File:** \`pets.js\` · **Routes:** \`/\` · \`/pets\` · \`/pets/:id\` · \`/adopted\`

Create a reusable \`PetCard\` showing **emoji**, **name**, **type**, **breed** and **age**.

- **Special rule:** if \`ageMonths < 12\` show "N months", otherwise show full years (\`26 → "2 years"\`).
- **Badge:** \`Vaccinated ✓\` or \`Vaccination Pending\`. A pet that is not vaccinated **cannot** be adopted — show "Vaccination Pending" instead of the button.
- **Adopt** button → \`isAdopted: true\`. **Cancel Adoption** button → \`isAdopted: false\`.
- Show \`Free\` if \`adoptionFee\` is \`0\`, otherwise \`₹adoptionFee\`.
- **Dropdown filter:** type (All, Dog, Cat, Rabbit, Bird).
- **Details page** also shows **gender**, **vaccination status** and **adoption fee**.
- **Home** shows total pets, pets ready for adoption (vaccinated and not adopted) and adopted pets. **/adopted** shows adopted pets and the total adoption fee, or "No pets adopted yet".
`

const DESC_P9 = `# P9 — Campus Placement Drive

**File:** \`companies.js\` · **Routes:** \`/\` · \`/companies\` · \`/companies/:id\` · \`/applications\`

Create a reusable \`CompanyCard\` showing **name**, **role**, **package (LPA)**, **location** and **drive date**.

- Import \`myProfile\` from the dataset (branch CSE, CGPA 7.5) and show it on Home.
- **Special rule:** a company is \`Eligible\` only if \`myProfile.cgpa >= minCGPA\` **and** \`eligibleBranches\` includes \`myProfile.branch\`. Otherwise show \`Not Eligible\`.
- Extra badge \`Dream Company\` if \`packageLPA >= 10\`.
- **Apply ↔ Withdraw** (\`isApplied\`) only for eligible companies. Not eligible companies show "Not Eligible" text instead of the button.
- **Dropdown filter:** All, Eligible, Not Eligible.
- **Details page** also shows **minimum CGPA** and the **eligible branches** using \`map()\`.
- **Home** shows total companies, eligible companies and applied companies. **/applications** shows applied companies, or "No applications yet".
`

// ─────────────────────────────────────────────────────────────────────────────
// Compose all 10 problem templates
// ─────────────────────────────────────────────────────────────────────────────

const PROBLEMS: ProblemConfig[] = [
  { id: 'p0', title: 'P0 — Library Book Manager',    item: 'Book',    itemLower: 'book',    list: 'Books',    listPath: '/books',    saved: 'Issued',       savedPath: '/issued',       savedVerb: 'issued',    datasetFile: 'books.js',    datasetExport: 'books',    dataset: BOOKS_JS,    description: DESC_P0 },
  { id: 'p1', title: 'P1 — Hostel Room Booking',     item: 'Room',    itemLower: 'room',    list: 'Rooms',    listPath: '/rooms',    saved: 'MyBooking',    savedPath: '/my-booking',   savedVerb: 'booked',    datasetFile: 'rooms.js',    datasetExport: 'rooms',    dataset: ROOMS_JS,    description: DESC_P1 },
  { id: 'p2', title: 'P2 — College Fest Events',     item: 'Event',   itemLower: 'event',   list: 'Events',   listPath: '/events',   saved: 'Registered',   savedPath: '/registered',   savedVerb: 'registered',datasetFile: 'events.js',   datasetExport: 'events',   dataset: EVENTS_JS,   description: DESC_P2 },
  { id: 'p3', title: 'P3 — Recipe Book',             item: 'Recipe',  itemLower: 'recipe',  list: 'Recipes',  listPath: '/recipes',  saved: 'Favourites',   savedPath: '/favourites',   savedVerb: 'favourite', datasetFile: 'recipes.js',  datasetExport: 'recipes',  dataset: RECIPES_JS,  description: DESC_P3 },
  { id: 'p4', title: 'P4 — Doctor Appointment',      item: 'Doctor',  itemLower: 'doctor',  list: 'Doctors',  listPath: '/doctors',  saved: 'Appointments', savedPath: '/appointments', savedVerb: 'booked',    datasetFile: 'doctors.js',  datasetExport: 'doctors',  dataset: DOCTORS_JS,  description: DESC_P4 },
  { id: 'p5', title: 'P5 — Job Portal',              item: 'Job',     itemLower: 'job',     list: 'Jobs',     listPath: '/jobs',     saved: 'Applied',      savedPath: '/applied',      savedVerb: 'applied',   datasetFile: 'jobs.js',     datasetExport: 'jobs',     dataset: JOBS_JS,     description: DESC_P5 },
  { id: 'p6', title: 'P6 — Music Playlist',          item: 'Song',    itemLower: 'song',    list: 'Songs',    listPath: '/songs',    saved: 'Playlist',     savedPath: '/playlist',     savedVerb: 'in playlist',datasetFile: 'songs.js',   datasetExport: 'songs',    dataset: SONGS_JS,    description: DESC_P6 },
  { id: 'p7', title: 'P7 — Bike Rental',             item: 'Bike',    itemLower: 'bike',    list: 'Bikes',    listPath: '/bikes',    saved: 'Rented',       savedPath: '/rented',       savedVerb: 'rented',    datasetFile: 'bikes.js',    datasetExport: 'bikes',    dataset: BIKES_JS,    description: DESC_P7 },
  { id: 'p8', title: 'P8 — Pet Adoption',            item: 'Pet',     itemLower: 'pet',     list: 'Pets',     listPath: '/pets',     saved: 'Adopted',      savedPath: '/adopted',      savedVerb: 'adopted',   datasetFile: 'pets.js',     datasetExport: 'pets',     dataset: PETS_JS,     description: DESC_P8 },
  { id: 'p9', title: 'P9 — Campus Placement Drive',  item: 'Company', itemLower: 'company', list: 'Companies', listPath: '/companies',saved: 'Applications', savedPath: '/applications', savedVerb: 'applied',   datasetFile: 'companies.js',datasetExport: 'companies',dataset: COMPANIES_JS,description: DESC_P9 },
]

export const WEB301_TEMPLATES: ExamTemplate[] = PROBLEMS.map(p => ({
  id: `web301-${p.id}`,
  title: `WEB 301 · ${p.title}`,
  description: p.description,
  starter_files: buildStarter(p),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Practice problem: same scaffold as the exam, a topic none of P0–P9 uses.
// Kept out of WEB301_TEMPLATES so "Import all 10" never picks it up.
// ─────────────────────────────────────────────────────────────────────────────

const MOVIES_JS = `export const movies = [
  { id: 1,  title: 'Inception',                 director: 'Christopher Nolan', genre: 'Sci-Fi', year: 2010, durationMins: 148, language: 'English', rating: 8.8, isInWatchlist: false },
  { id: 2,  title: '3 Idiots',                  director: 'Rajkumar Hirani',   genre: 'Comedy', year: 2009, durationMins: 170, language: 'Hindi',   rating: 8.4, isInWatchlist: false },
  { id: 3,  title: 'Mad Max: Fury Road',        director: 'George Miller',     genre: 'Action', year: 2015, durationMins: 120, language: 'English', rating: 8.1, isInWatchlist: false },
  { id: 4,  title: 'Taare Zameen Par',          director: 'Aamir Khan',        genre: 'Drama',  year: 2007, durationMins: 165, language: 'Hindi',   rating: 8.3, isInWatchlist: false },
  { id: 5,  title: 'Interstellar',              director: 'Christopher Nolan', genre: 'Sci-Fi', year: 2014, durationMins: 169, language: 'English', rating: 8.7, isInWatchlist: false },
  { id: 6,  title: 'Andhadhun',                 director: 'Sriram Raghavan',   genre: 'Drama',  year: 2018, durationMins: 139, language: 'Hindi',   rating: 8.2, isInWatchlist: false },
  { id: 7,  title: 'The Grand Budapest Hotel',  director: 'Wes Anderson',      genre: 'Comedy', year: 2014, durationMins: 99,  language: 'English', rating: 8.1, isInWatchlist: false },
  { id: 8,  title: 'Baahubali: The Beginning',  director: 'S. S. Rajamouli',   genre: 'Action', year: 2015, durationMins: 159, language: 'Telugu',  rating: 8.0, isInWatchlist: false },
  { id: 9,  title: 'Tenet',                     director: 'Christopher Nolan', genre: 'Sci-Fi', year: 2020, durationMins: 150, language: 'English', rating: 7.3, isInWatchlist: false },
  { id: 10, title: 'Golmaal: Fun Unlimited',    director: 'Rohit Shetty',      genre: 'Comedy', year: 2006, durationMins: 150, language: 'Hindi',   rating: 7.4, isInWatchlist: false },
]
`

const DESC_SAMPLE = `# SAMPLE — Movie Watchlist

> **Practice problem, not graded.** Use it to get comfortable with the editor, the live preview and the Submit button before the real test. Your exam problem will be different.

**File:** \`movies.js\` · **Routes:** \`/\` · \`/movies\` · \`/movies/:id\` · \`/watchlist\`

Create a reusable \`MovieCard\` showing **title**, **director**, **genre** and **year**.

- **Badge:** \`Top Rated ⭐\` if \`rating >= 8\`.
- **Toggle button:** "Add to Watchlist" ↔ "Remove from Watchlist" (\`isInWatchlist\`).
- **Dropdown filter:** genre (All, Action, Drama, Comedy, Sci-Fi).
- **Details page** also shows **duration (mins)**, **language** and **rating**.
- **Home** shows total movies, movies in the watchlist and top-rated movies.
- **/watchlist** shows only watchlist movies and their total watch time in minutes, or "Your watchlist is empty".
`

const SAMPLE: ProblemConfig = {
  id: 'sample', title: 'SAMPLE · React Practice — Movie Watchlist (not graded)',
  item: 'Movie', itemLower: 'movie', list: 'Movies', listPath: '/movies',
  saved: 'Watchlist', savedPath: '/watchlist', savedVerb: 'in watchlist',
  datasetFile: 'movies.js', datasetExport: 'movies', dataset: MOVIES_JS, description: DESC_SAMPLE,
}

export const WEB301_SAMPLE: ExamTemplate = {
  id: 'web301-sample',
  title: SAMPLE.title,
  description: SAMPLE.description,
  // Retitled so nobody mistakes the practice run for the exam.
  starter_files: Object.fromEntries(
    Object.entries(buildStarter(SAMPLE)).map(([name, code]) =>
      [name, code.replaceAll('WEB 301 — Mid-Sem Phase 2', 'SAMPLE — React Practice')]),
  ),
}
