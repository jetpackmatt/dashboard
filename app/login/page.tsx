import LoginForm from './LoginForm'

// Prevent static generation - client component needs runtime env vars
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return <LoginForm />
}
