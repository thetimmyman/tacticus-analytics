export function validateEmail(email: string): {
  isValid: boolean
  error?: string
} {
  if (!email) return { isValid: false, error: 'Email is required' }

  const trimmed = email.trim().toLowerCase()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!emailRegex.test(trimmed)) {
    return { isValid: false, error: 'Invalid email address' }
  }

  return { isValid: true }
}

// Must be at least as strict as the auth server's password policy, or forms
// accept passwords the server rejects. Every form must use these exports.
export const PASSWORD_MIN_LENGTH = 12

export function validatePassword(password: string): {
  isValid: boolean
  error?: string
} {
  if (!password) return { isValid: false, error: 'Password is required' }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      isValid: false,
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
    }
  }

  if (!/[a-z]/.test(password)) {
    return {
      isValid: false,
      error: 'Password must contain at least one lowercase letter'
    }
  }

  if (!/[A-Z]/.test(password)) {
    return {
      isValid: false,
      error: 'Password must contain at least one uppercase letter'
    }
  }

  if (!/\d/.test(password)) {
    return {
      isValid: false,
      error: 'Password must contain at least one number'
    }
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return {
      isValid: false,
      error:
        'Password must contain at least one special character (!@#$%^&*(),.?":{}|<>)'
    }
  }

  const commonPasswords = [
    'password',
    '12345678',
    'qwerty123',
    'admin123',
    'password123'
  ]
  if (commonPasswords.some((weak) => password.toLowerCase().includes(weak))) {
    return {
      isValid: false,
      error: 'Password is too common. Please choose a more secure password'
    }
  }

  return { isValid: true }
}

export function validateUrl(url: string): boolean {
  if (!url) return true // Allow empty URLs
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export interface ValidationResult {
  isValid: boolean
  error?: string
}
