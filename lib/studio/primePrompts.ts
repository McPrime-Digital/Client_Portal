// Shared PrimeOS prompt library — used by the floating assistant (PrimeOSAssistant)
// and the full-page chat (PrimeOSChat) so both stay in sync.

export type Turn = { role: 'user' | 'assistant'; text: string; applicable?: boolean }

export const QUICK_SEL = ['Improve writing', 'Make it shorter', 'Make it longer', 'Fix grammar', 'Rephrase', 'More cinematic', 'Continue writing']
export const QUICK_NONE = ['Continue writing', 'Write the next scene', 'Brainstorm ideas', 'Outline this sequence', 'Suggest a stronger title']

// Expert lenses — shape the model's system prompt for film + automation work.
export const PERSONAS = [
  { id: 'screenwriter', label: 'Screenwriter', sys: 'You are a master screenwriter — vivid action lines, subtext-rich dialogue, correct screenplay format and rhythm.' },
  { id: 'doctor', label: 'Script Doctor', sys: 'You are a veteran script doctor. Diagnose structure, pacing, motivation and dialogue, and fix them incisively.' },
  { id: 'director', label: 'Director', sys: 'You are a film director. Think in shots, blocking, coverage, visual storytelling and tone.' },
  { id: 'producer', label: 'Showrunner', sys: 'You are a showrunner/producer — story arcs, marketability, budget-aware choices and series logic.' },
  { id: 'copy', label: 'Ad Copywriter', sys: 'You are a world-class advertising copywriter — punchy hooks, persuasion, brand-safe lines and strong CTAs.' },
  { id: 'editor', label: 'Story Editor', sys: 'You are a sharp story editor — clarity, continuity, theme and line-level polish without losing the writer’s voice.' },
  { id: 'automation', label: 'Automation Architect', sys: 'You are an automation/workflow architect. Design robust automations — triggers, steps, integrations, data shapes, retries and error handling — and write precise specs or JSON when asked.' },
]

// Action library — high-leverage commands for drafting film + automations fast.
export const COMMANDS: { group: string; items: string[] }[] = [
  { group: 'Write', items: ['Continue writing', 'Write the next scene', 'Draft dialogue for this beat', 'Write a logline', 'Write a one-paragraph synopsis', 'Write director’s coverage notes'] },
  { group: 'Improve', items: ['Punch up the dialogue', 'Tighten for runtime', 'Stronger verbs & imagery', 'Show, don’t tell', 'Fix grammar & spelling', 'Make it more cinematic'] },
  { group: 'Transform', items: ['Format as a screenplay', 'Turn into a beat sheet', 'Turn into a shot list', 'Turn into a treatment', 'Summarize', 'Translate to…'] },
  { group: 'Film', items: ['Suggest shots & coverage', 'Continuity check', 'Character voice pass', 'Add stage directions', 'Shift the genre/tone', 'Generate 3 alternate takes'] },
  { group: 'Automation', items: ['Draft an automation spec', 'Outline a workflow', 'Write integration steps', 'Generate a JSON config', 'Add error handling & retries'] },
]
