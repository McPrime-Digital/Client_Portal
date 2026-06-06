// Pure font data — no React/BlockNote imports, so it's safe to import from both
// the server layout (to load the stylesheet) and the client editor.

// Family value is the CSS font-family stack; '' = document default.
// `web` (when set) is the Google Fonts family spec used to build the stylesheet.
type Font = { label: string; value: string; web?: string }

export const FONT_FAMILIES: Font[] = [
  { label: 'Default', value: '' },
  // System
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Calibri', value: 'Calibri, "Segoe UI", sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
  { label: 'Palatino', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Impact', value: 'Impact, Haettenschweiler, sans-serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", "Comic Sans", cursive' },
  // Web — sans
  { label: 'Inter', value: 'Inter, sans-serif', web: 'Inter:wght@400;500;600;700' },
  { label: 'Roboto', value: 'Roboto, sans-serif', web: 'Roboto:wght@400;500;700' },
  { label: 'Open Sans', value: '"Open Sans", sans-serif', web: 'Open+Sans:wght@400;600;700' },
  { label: 'Lato', value: 'Lato, sans-serif', web: 'Lato:wght@400;700' },
  { label: 'Montserrat', value: 'Montserrat, sans-serif', web: 'Montserrat:wght@400;600;700' },
  { label: 'Poppins', value: 'Poppins, sans-serif', web: 'Poppins:wght@400;500;600' },
  { label: 'Raleway', value: 'Raleway, sans-serif', web: 'Raleway:wght@400;600' },
  { label: 'Nunito', value: 'Nunito, sans-serif', web: 'Nunito:wght@400;700' },
  { label: 'Work Sans', value: '"Work Sans", sans-serif', web: 'Work+Sans:wght@400;600' },
  { label: 'DM Sans', value: '"DM Sans", sans-serif', web: 'DM+Sans:wght@400;500;700' },
  { label: 'Oswald', value: 'Oswald, sans-serif', web: 'Oswald:wght@400;600' },
  { label: 'Bebas Neue', value: '"Bebas Neue", sans-serif', web: 'Bebas+Neue' },
  { label: 'Archivo', value: 'Archivo, sans-serif', web: 'Archivo:wght@400;600;700' },
  // Web — serif
  { label: 'Merriweather', value: 'Merriweather, serif', web: 'Merriweather:wght@400;700' },
  { label: 'Playfair Display', value: '"Playfair Display", serif', web: 'Playfair+Display:wght@400;600;700' },
  { label: 'Lora', value: 'Lora, serif', web: 'Lora:wght@400;600' },
  { label: 'PT Serif', value: '"PT Serif", serif', web: 'PT+Serif:wght@400;700' },
  { label: 'Libre Baskerville', value: '"Libre Baskerville", serif', web: 'Libre+Baskerville' },
  { label: 'Cormorant Garamond', value: '"Cormorant Garamond", serif', web: 'Cormorant+Garamond:wght@400;600' },
  { label: 'Crimson Text', value: '"Crimson Text", serif', web: 'Crimson+Text:wght@400;600' },
  // Web — mono / display / script
  { label: 'Source Code Pro', value: '"Source Code Pro", monospace', web: 'Source+Code+Pro:wght@400;600' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace', web: 'JetBrains+Mono:wght@400;700' },
  { label: 'Space Mono', value: '"Space Mono", monospace', web: 'Space+Mono:wght@400;700' },
  { label: 'Dancing Script', value: '"Dancing Script", cursive', web: 'Dancing+Script:wght@400;700' },
  { label: 'Pacifico', value: 'Pacifico, cursive', web: 'Pacifico' },
  { label: 'Caveat', value: 'Caveat, cursive', web: 'Caveat:wght@400;700' },
]

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96]

// One Google Fonts stylesheet href covering every web font above.
export const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?' +
  FONT_FAMILIES.filter((f) => f.web).map((f) => `family=${f.web}`).join('&') +
  '&display=swap'
