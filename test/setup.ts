import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Without globals: true, testing-library does not register its own auto-cleanup,
// so rendered trees pile up and every getByRole finds "multiple elements".
afterEach(cleanup)
