# React quick reference

Bundled documentation for React assignments. Covers the common patterns you
need in this editor: components, JSX, props, state, effects, event
handlers, lists, forms, and routing.

Based on the [official React docs](https://react.dev) — kept inside the app
so it works under Safe Exam Browser.

---

## Components & JSX

A component is a function that returns JSX.

```jsx
function Hello() {
  return <h1>Hello, world</h1>
}

export default function App() {
  return (
    <div>
      <Hello />
      <Hello />
    </div>
  )
}
```

**JSX rules**

- Return exactly one parent element — wrap siblings in a `<div>` or a
  fragment `<>…</>`.
- Attributes are camelCase: `className` (not `class`), `onClick`, `htmlFor`.
- Embed JavaScript with `{ }`: `<p>{user.name}</p>`.
- Self-close void tags: `<img src="…" />`, `<br />`.

---

## Props

Props are the inputs to a component.

```jsx
function Greeting({ name, age }) {
  return <p>{name} is {age} years old</p>
}

<Greeting name="Ada" age={36} />
```

**Children**

```jsx
function Card({ children }) {
  return <div className="card">{children}</div>
}

<Card><p>Anything goes here</p></Card>
```

---

## State — `useState`

State is data the component owns and can change.

```jsx
import { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>+1</button>
      <button onClick={() => setCount(0)}>reset</button>
    </div>
  )
}
```

**Rules**

- Call hooks at the top of the component, never inside `if` / loops.
- Treat state as read-only — don't mutate. Use the setter.
- Updating state is asynchronous; use the function form when the new value
  depends on the old one: `setCount(c => c + 1)`.

Updating an object or array:

```jsx
setUser({ ...user, name: 'Grace' })          // object
setItems([...items, newItem])                // append
setItems(items.filter(i => i.id !== id))     // remove
```

---

## Effects — `useEffect`

Run side effects (fetching data, timers, subscriptions) after render.

```jsx
import { useEffect, useState } from 'react'

export default function Clock() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)   // cleanup
  }, [])                             // [] = run once on mount

  return <p>{now.toLocaleTimeString()}</p>
}
```

**Dependency array**

- `[]` — runs once after mount.
- `[a, b]` — runs when `a` or `b` changes.
- Omitted — runs after every render (rarely what you want).

---

## Event handlers

```jsx
function Button() {
  function handleClick(e) {
    console.log('clicked', e.target)
  }
  return <button onClick={handleClick}>Click me</button>
}
```

Common handlers: `onClick`, `onChange`, `onSubmit`, `onInput`,
`onKeyDown`, `onMouseEnter`.

---

## Conditional rendering

```jsx
{isLoggedIn && <LogoutButton />}

{isLoggedIn ? <LogoutButton /> : <LoginButton />}

{status === 'loading' && <Spinner />}
```

---

## Lists & keys

```jsx
const fruits = ['apple', 'banana', 'cherry']

<ul>
  {fruits.map(f => (
    <li key={f}>{f}</li>
  ))}
</ul>
```

`key` must be **stable and unique** among siblings. Prefer an id from your
data over the array index when items can be reordered.

---

## Forms (controlled inputs)

```jsx
import { useState } from 'react'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    console.log({ email, password })
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
      />
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
      />
      <button type="submit">Sign in</button>
    </form>
  )
}
```

Checkbox:

```jsx
<input
  type="checkbox"
  checked={agreed}
  onChange={e => setAgreed(e.target.checked)}
/>
```

Select:

```jsx
<select value={color} onChange={e => setColor(e.target.value)}>
  <option value="red">Red</option>
  <option value="blue">Blue</option>
</select>
```

---

## Refs — `useRef`

Reach a DOM node, or keep a mutable value that does not trigger re-render.

```jsx
import { useRef, useEffect } from 'react'

export default function AutoFocus() {
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current.focus() }, [])
  return <input ref={inputRef} />
}
```

---

## Context — share without prop-drilling

```jsx
import { createContext, useContext, useState } from 'react'

const ThemeContext = createContext('light')

function Toolbar() {
  const theme = useContext(ThemeContext)
  return <div className={theme}>Toolbar</div>
}

export default function App() {
  const [theme, setTheme] = useState('dark')
  return (
    <ThemeContext.Provider value={theme}>
      <Toolbar />
      <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
        Toggle
      </button>
    </ThemeContext.Provider>
  )
}
```

---

## Routing — `react-router-dom`

```jsx
import { HashRouter, Routes, Route, Link } from 'react-router-dom'

function Home()  { return <h1>Home</h1> }
function About() { return <h1>About</h1> }

export default function App() {
  return (
    <HashRouter>
      <nav>
        <Link to="/">Home</Link> · <Link to="/about">About</Link>
      </nav>
      <Routes>
        <Route path="/"      element={<Home />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </HashRouter>
  )
}
```

> In this editor, use `HashRouter` (the preview automatically rewrites
> `BrowserRouter` → `HashRouter` so routes work inside the sandbox).

---

## Styling

- Inline: `<div style={{ color: 'red', fontSize: 14 }}>` — camelCase.
- Classes: `<div className="card primary">` — reference rules in `styles.css`.
- Import a stylesheet in your entry file: `import './styles.css'`.

---

## Common hooks at a glance

| Hook | What it does |
|---|---|
| `useState` | Add component state. |
| `useEffect` | Run side effects after render. |
| `useRef` | Keep a mutable value / reach a DOM node. |
| `useContext` | Read a context value. |
| `useMemo` | Cache an expensive computed value. |
| `useCallback` | Cache a function identity for child components. |

---

## Common gotchas

- **Stale closures in `useEffect`**: if your effect reads state but the
  dependency array is `[]`, you'll see the first value forever. Add the
  dependency, or use the functional updater: `setX(prev => …)`.
- **Mutating state**: `items.push(x); setItems(items)` does **not**
  re-render. Make a new array: `setItems([...items, x])`.
- **Missing keys**: `<li>{text}</li>` inside `.map()` without a `key`
  warns in the console and breaks reordering.
- **Lower-case component**: `<myComponent />` is treated as an HTML tag.
  Component names must start with an uppercase letter.
- **Calling a hook conditionally**: `if (…) useState(…)` throws.
  Always call hooks unconditionally at the top of the component.
