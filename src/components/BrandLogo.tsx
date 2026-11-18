import { Link } from 'react-router-dom'

interface Props {
  /** Text shown after the logo, e.g. "Mirai Evaluation" or "Mirai Evaluation · Admin". */
  label?: string
  /** Logo height in px. The SVG is 217×30. */
  height?: number
  to?: string
  className?: string
}

// Mirai School of Technology wordmark + product name. The SVG is white on
// transparent, so it only works on the dark (navy) backgrounds used here.
export default function BrandLogo({ label = 'Mirai Evaluation', height = 24, to = '/', className = '' }: Props) {
  return (
    <Link to={to} className={`flex items-center gap-3 shrink-0 ${className}`} aria-label={`Mirai School of Technology · ${label}`}>
      <img src="/mirai-logo.svg" alt="Mirai School of Technology" style={{ height }} className="w-auto" />
      {label && (
        <>
          <span className="hidden sm:block h-5 w-px bg-vs-border" aria-hidden />
          <span className="hidden sm:inline font-semibold tracking-tight text-white whitespace-nowrap">{label}</span>
        </>
      )}
    </Link>
  )
}
