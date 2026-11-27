import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import BrandLogo from '../../components/BrandLogo'

const tab = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded text-sm ${isActive ? 'bg-vs-panel text-vs-text' : 'text-vs-mute hover:text-vs-text'}`

export default function AdminLayout() {
  const { profile, signOut } = useAuth()
  return (
    <div className="min-h-screen">
      <header className="brand-header px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <BrandLogo label="Mirai Evaluation · Admin" />
          <nav className="flex items-center gap-1">
            <NavLink to="/admin/projects" className={tab}>Projects</NavLink>
            <NavLink to="/admin/assignments" className={tab}>Assignments</NavLink>
            <NavLink to="/admin/submissions" className={tab}>Submissions</NavLink>
            <NavLink to="/admin/exam-security" className={tab}>Exam security</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden md:inline text-vs-mute">{profile?.email}</span>
          <button className="btn-ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
