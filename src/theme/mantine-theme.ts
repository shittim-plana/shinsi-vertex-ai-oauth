import { createTheme, MantineColorsTuple } from '@mantine/core';

// Light gray-blue primary color (softer than the original blue)
const primaryLightBlue: MantineColorsTuple = [
  '#f0f5fa',
  '#e1ecf5',
  '#c3d9ea',
  '#a5c6e0',
  '#8db8d9',
  '#7eaed5',
  '#75a9d3',
  '#639bc4',
  '#548db5',
  '#417ea6'
];

const secondaryLightPink: MantineColorsTuple = [
  '#fff9fb',
  '#ffeff5',
  '#ffe0eb',
  '#ffd1e1',
  '#ffc7da',
  '#ffbdd5',
  '#ffb7d1',
  '#e6a3bc',
  '#cc90a7',
  '#b37d92'
];

// Create theme with white background and light colors
export const theme = createTheme({
  primaryColor: 'lightBlue',
  colors: {
    lightBlue: primaryLightBlue,
    lightPink: secondaryLightPink,
  },
  fontFamily: 'Inter, sans-serif',
  headings: {
    fontFamily: 'Inter, sans-serif',
    sizes: {
      h1: { fontSize: '2.5rem' },
      h2: { fontSize: '2rem' },
      h3: { fontSize: '1.5rem' },
      h4: { fontSize: '1.25rem' },
      h5: { fontSize: '1rem' },
      h6: { fontSize: '0.875rem' },
    },
  },
  components: {
    Button: {
      defaultProps: {
        radius: 'md',
      },
    },
    Card: {
      defaultProps: {
        radius: 'md',
        shadow: 'xs',
      },
    },
    Input: {
      defaultProps: {
        radius: 'md',
      },
    },
    Paper: {
      // Ensure Paper uses theme background
    },
    AppShell: {
      // Ensure AppShell uses theme background
    },
  },
  defaultRadius: 'md',
  // Let Mantine handle white/black based on color scheme
});

export default theme;