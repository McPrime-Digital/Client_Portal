// The 3-space information architecture for Throughline's internal/studio shell.
// Crew (team only) · Client (client-facing) · Workspace (the work). Each space
// lists its features; `phase` ties to the Throughline build plan (docs/throughline-master-plan.md).
import type { LucideIcon } from 'lucide-react'
import {
  UsersRound, Handshake, Clapperboard,
  MessageSquare, ListChecks, GitBranchPlus, Radar, Gauge, Video, Contact,
  LayoutDashboard, FolderOpen, ScanEye, Files, MessageCircle, Receipt, Link2, Building2,
  Film, Workflow, Aperture, Sparkles, Wand2, Fingerprint, Swords, Library, ShieldCheck, NotebookPen, SlidersHorizontal,
  CalendarDays, Settings, Palette, FileText, Package,
} from 'lucide-react'

export type SpaceId = 'crew' | 'client' | 'workspace'
// `legacyHref`: the working admin-portal tool this feature routes to until its
// studio-native version ships — keeps every space entry functional, never a stub.
export type Feature = { slug: string; label: string; icon: LucideIcon; phase: number; badge?: string; legacyHref?: string }
export type Space = { id: SpaceId; label: string; icon: LucideIcon; blurb: string; features: Feature[] }

export const SPACES: Space[] = [
  {
    id: 'crew', label: 'Crew', icon: UsersRound,
    blurb: 'Your team only — collaboration, pipeline, and the AI control tower clients never see.',
    features: [
      { slug: 'chat', label: 'Team Chat', icon: MessageSquare, phase: 4 },
      { slug: 'tasks', label: 'Tasks & Assignments', icon: ListChecks, phase: 4 },
      { slug: 'calendar', label: 'Calendar', icon: CalendarDays, phase: 4 },
      { slug: 'meetings', label: 'Meetings', icon: Video, phase: 5 },
      { slug: 'crm', label: 'CRM · Pipeline', icon: GitBranchPlus, phase: 5 },
      { slug: 'leads', label: 'Lead-Gen Pipelines', icon: Radar, phase: 5 },
      { slug: 'control-tower', label: 'Control Tower', icon: Gauge, phase: 3, badge: 'COST' },
      { slug: 'directory', label: 'Team Directory', icon: Contact, phase: 4 },
      { slug: 'settings', label: 'Settings', icon: Settings, phase: 1, legacyHref: '/admin/settings' },
    ],
  },
  {
    id: 'client', label: 'Client', icon: Handshake,
    blurb: 'Everything client-facing — projects, frame-accurate review, deliverables, and billing.',
    features: [
      { slug: 'overview', label: 'Overview', icon: LayoutDashboard, phase: 0, legacyHref: '/admin' },
      { slug: 'projects', label: 'Projects', icon: FolderOpen, phase: 0, legacyHref: '/admin/projects' },
      { slug: 'review', label: 'Review & Approvals', icon: ScanEye, phase: 1, badge: 'LIVE' },
      { slug: 'deliverables', label: 'Deliverables · Vault', icon: Files, phase: 1, legacyHref: '/admin/files' },
      { slug: 'documents', label: 'Documents', icon: FileText, phase: 4 },
      { slug: 'messages', label: 'Messages', icon: MessageCircle, phase: 0, legacyHref: '/admin/messages' },
      { slug: 'invoices', label: 'Invoices & Payments', icon: Receipt, phase: 1, legacyHref: '/admin/invoices' },
      { slug: 'brand-kit', label: 'Brand Kit', icon: Palette, phase: 3 },
      { slug: 'guest-links', label: 'Guest Review Links', icon: Link2, phase: 2 },
      { slug: 'companies', label: 'Companies & Contacts', icon: Building2, phase: 4, legacyHref: '/admin/clients' },
    ],
  },
  {
    id: 'workspace', label: 'Workspace', icon: Clapperboard,
    blurb: 'Where the work is made — storyboard, the pipeline graph, and the AI production engine.',
    features: [
      // Lifecycle order: pre-pro → produce → finish → cross-cutting tools.
      // Script Design: collaborative concept dev, narrative architecture, scripting, brand/crew alignment.
      { slug: 'script', label: 'Script Design', icon: NotebookPen, phase: 2 },
      // Storyboard (film) and Workflow (automation / the Graph) are SEPARATE tabs — each
      // persona lives in one; a side-by-side toggle inside either brings up the other.
      { slug: 'storyboard', label: 'Storyboard', icon: Film, phase: 2 },
      { slug: 'workflow', label: 'Workflow', icon: Workflow, phase: 2, badge: 'CORE' },
      { slug: 'generation', label: 'The Stage', icon: Sparkles, phase: 3 },
      { slug: 'remaster', label: 'Remaster', icon: Wand2, phase: 3 },
      // Finishing Suite: AI-native post — edit assist, sound, VO, mastering, color.
      { slug: 'finishing', label: 'Finishing Suite', icon: SlidersHorizontal, phase: 3 },
      // PrimeOS AI: brainstorm → draft → architect scripts, automations, and film. Switchable model mid-chat.
      { slug: 'ai-chat', label: 'PrimeOS', icon: Aperture, phase: 3 },
      { slug: 'continuity', label: 'Continuity', icon: Fingerprint, phase: 2, badge: 'NEW' },
      { slug: 'arena', label: 'Model Arena', icon: Swords, phase: 3 },
      { slug: 'studio-kits', label: 'Studio Kits', icon: Package, phase: 4 },
      { slug: 'library', label: 'Asset Library · DAM', icon: Library, phase: 4 },
      { slug: 'provenance', label: 'Provenance & Rights', icon: ShieldCheck, phase: 4 },
    ],
  },
]

export function getSpace(id: string): Space | undefined {
  return SPACES.find((s) => s.id === id)
}
