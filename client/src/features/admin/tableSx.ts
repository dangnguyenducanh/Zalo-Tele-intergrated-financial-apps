// Style for the wrapper around an admin <table> (modern-web-guidance `responsive-table`): a real table
// when there is room, and one card per row when the wrapper is narrower than 600px. A container query
// (not a media query) decides, so it follows the space the table really gets next to the side drawer.
// In card mode the column headers are hidden and each cell shows its header from data-label instead.
export const tableWrapperSx = {
  containerType: 'inline-size',
  overflowX: 'auto',
  '@container (width < 600px)': {
    '& table, & caption, & tbody, & tr, & th, & td': { display: 'block', width: '100%' },
    '& thead': { display: 'none' },
    '& tr': { mb: 2, border: 1, borderColor: 'divider', borderRadius: 2 },
    '& th, & td': { borderBottom: 'none', py: 0.75 },
    '& td[data-label]::before': { content: 'attr(data-label) ": "', fontWeight: 600 },
  },
} as const;
