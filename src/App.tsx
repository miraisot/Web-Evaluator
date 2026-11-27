import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { supabaseConfigured } from './lib/supabase'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Home from './pages/Home'
import Solve from './pages/Solve'
import ExamDone from './pages/ExamDone'
import AdminLayout from './pages/admin/AdminLayout'
import Projects from './pages/admin/Projects'
import ProjectEdit from './pages/admin/ProjectEdit'
import Assignments from './pages/admin/Assignments'
import Submissions from './pages/admin/Submissions'
import SubmissionView from './pages/admin/SubmissionView'
import ExamSecurity from './pages/admin/ExamSecurity'

function Protected({ children, admin }: { children: JSX.Element; admin?: boolean }) {
  const { session, profile, loading } = useAuth()
  if (loading) return <div className="p-8 text-vs-mute">Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  if (admin && profile?.role !== 'admin') return <Navigate to="/" replace />
  return children
}

function SetupScreen() {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="card max-w-xl space-y-3">
        <h1 className="text-lg font-semibold">Setup needed</h1>
        <p className="text-sm text-vs-mute">
          Supabase credentials aren't configured. Create a <code className="text-vs-text">.env</code> file in the project root with:
        </p>
        <pre className="bg-vs-bg border border-vs-border rounded p-3 text-xs overflow-auto">
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co{'\n'}VITE_SUPABASE_ANON_KEY=your-anon-key
        </pre>
        <p className="text-sm text-vs-mute">
          Get those from your Supabase dashboard → <em>Project Settings → API</em>. Then restart <code className="text-vs-text">npm run dev</code>. Full setup is in the README.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  if (!supabaseConfigured) return <SetupScreen />
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/exam/done" element={<ExamDone />} />
        <Route path="/" element={<Protected><Home /></Protected>} />
        <Route path="/solve/:assignmentId" element={<Protected><Solve /></Protected>} />
        <Route path="/admin" element={<Protected admin><AdminLayout /></Protected>}>
          <Route index element={<Navigate to="projects" replace />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectEdit />} />
          <Route path="assignments" element={<Assignments />} />
          <Route path="submissions" element={<Submissions />} />
          <Route path="submissions/:id" element={<SubmissionView />} />
          <Route path="exam-security" element={<ExamSecurity />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
