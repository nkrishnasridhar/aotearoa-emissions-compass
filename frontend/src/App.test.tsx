import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Emissions Dashboard header', () => {
  render(<App />);
  const linkElement = screen.getByText(/Emissions Dashboard/i);
  expect(linkElement).toBeInTheDocument();
});
