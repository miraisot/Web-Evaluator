export type Role = 'student' | 'admin'

export type Campus = 'Hi-Tech' | 'RGIB' | 'JU' | 'Dummy'
export const CAMPUSES: Campus[] = ['Hi-Tech', 'RGIB', 'JU', 'Dummy']

export const SECTIONS = ['A', 'B', 'C', 'D', 'Dummy'] as const
export const SEMESTERS = ['1', '2', '3', '4', '5', '6', '7', '8', 'Dummy'] as const

// ---------- MERN assignment support ---------------------------------
// A project's `project_type` decides which editor + submission UI the
// student (and admin viewer) renders. Defaults to 'live_preview' so
// every existing project keeps working unchanged.
export type ProjectType = 'live_preview' | 'code_review' | 'external_link'
export const PROJECT_TYPES: ProjectType[] = ['live_preview', 'code_review', 'external_link']
export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  live_preview: 'Live preview (HTML/CSS/JS)',
  code_review: 'Code review (MERN / any language)',
  external_link: 'External link submission (GitHub + deployed URL)',
}

export type SubmissionType = 'code' | 'external_link'

export interface Profile {
  id: string
  email: string
  role: Role
  full_name?: string | null
  campus?: Campus | null
  semester?: string | null
  section?: string | null
}

export type FileMap = Record<string, string>

export interface Project {
  id: string
  title: string
  description: string
  starter_files: FileMap
  project_type: ProjectType
  created_at: string
}

export interface ProjectAsset {
  id: string
  project_id: string
  name: string
  storage_path: string
  public_url: string
  content_type: string | null
  size_bytes: number | null
}

export interface Assignment {
  id: string
  project_id: string
  assignee_email: string | null
  is_public: boolean
  starts_at: string
  ends_at: string
  created_at: string
}

export interface Submission {
  id: string
  assignment_id: string
  student_id: string
  files: FileMap
  submission_type: SubmissionType
  repo_url: string | null
  deployed_url: string | null
  notes: string | null
  submitted_at: string
}
