export type Role = 'student' | 'admin'

export type Campus = 'Hi-Tech' | 'RGIB' | 'JU' | 'Dummy'
export const CAMPUSES: Campus[] = ['Hi-Tech', 'RGIB', 'JU', 'Dummy']

export const SECTIONS = ['A', 'B', 'C', 'D', 'Dummy'] as const
export const SEMESTERS = ['1', '2', '3', '4', '5', '6', '7', '8', 'Dummy'] as const
// Admitted batch, named by graduation year.
export const BATCHES = ['2025', '2026'] as const
export type Batch = typeof BATCHES[number]

export interface Profile {
  id: string
  email: string
  role: Role
  full_name?: string | null
  uid?: string | null       // university ID, entered at signup
  campus?: Campus | null
  semester?: string | null
  section?: string | null
  batch?: Batch | string | null
}

export interface StudentRosterRow {
  email: string
  name: string | null
  uid: string | null
  campus: Campus | null
  batch: string
  created_at?: string
}

export type FileMap = Record<string, string>

export type ProjectType = 'html' | 'react'

export interface Project {
  id: string
  title: string
  description: string
  project_type: ProjectType
  category: Category
  starter_files: FileMap
  expected_output_url?: string | null
  expected_output_path?: string | null
  reference_md?: string | null
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
  submitted_at: string
  // Collected by the server from the last autosave after the deadline;
  // submitted_at is then the time of that autosave.
  auto_collected?: boolean
}

export type RubricCriterion = { key: string; label: string; max: number; desc?: string }

export const HTML_RUBRIC: RubricCriterion[] = [
  { key: 'correctness',  label: 'Correctness',  max: 10, desc: 'Met the stated requirements; expected elements/sections present and not broken.' },
  { key: 'design',       label: 'Design / UI',  max: 10, desc: 'Visual appeal, consistent styling, Flexbox/Grid usage, responsive layout.' },
  { key: 'code_quality', label: 'Code Quality', max: 10, desc: 'Semantic markup, well-named classes, clean structure, no obvious bugs.' },
]

export const REACT_RUBRIC: RubricCriterion[] = [
  { key: 'correctness',   label: 'Correctness',   max: 10, desc: 'Met the stated requirements; expected features present and the app renders without errors.' },
  { key: 'functionality', label: 'Functionality', max: 10, desc: 'State, data flow, user interactions and conditional rendering actually work.' },
  { key: 'code_quality',  label: 'Code Quality',  max: 10, desc: 'Component structure, hooks used correctly, clean naming, no obvious bugs.' },
]

export function rubricFor(projectType: ProjectType | undefined | null): RubricCriterion[] {
  return projectType === 'react' ? REACT_RUBRIC : HTML_RUBRIC
}

export type Course = 'WEB 101' | 'WEB 301'
export const COURSES: Course[] = ['WEB 101', 'WEB 301']
export function courseFor(projectType: ProjectType | undefined | null): Course {
  return projectType === 'react' ? 'WEB 301' : 'WEB 101'
}

export type Category = 'Assignments' | 'Bi-Weekly' | 'Mid-Term'
export const CATEGORIES: Category[] = ['Assignments', 'Bi-Weekly', 'Mid-Term']
export function categoryFor(project: Pick<Project, 'category' | 'title'> | null | undefined): Category {
  if (!project) return 'Assignments'
  if (project.category && (CATEGORIES as string[]).includes(project.category)) return project.category as Category
  // Fallback for rows the migration hasn't touched yet.
  return (project.title || '').toUpperCase().includes('SAMPLE') ? 'Bi-Weekly' : 'Mid-Term'
}

// Back-compat: default export used by code that doesn't know the project type.
export const RUBRIC: RubricCriterion[] = HTML_RUBRIC
export const RUBRIC_MAX = HTML_RUBRIC.reduce((n, r) => n + r.max, 0)

export interface Evaluation {
  id: string
  submission_id: string
  scores: Record<string, number>
  total: number
  max_total: number
  feedback: string
  feedback_by_criterion: Record<string, string>
  graded_by: string | null
  graded_at: string
  updated_at: string
}
