import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { prisma } from './prisma'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      companyId?: string | null
      companyName?: string | null
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    companyId?: string | null
    companyName?: string | null
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: {
            activeCompany: true,
            companies: {
              include: { company: true },
              take: 1,
            },
          },
        })

        if (!user) {
          return null
        }

        const isPasswordValid = await compare(
          credentials.password,
          user.passwordHash
        )

        if (!isPasswordValid) {
          return null
        }

        // Get active company or first available company
        const activeCompany = user.activeCompany || user.companies[0]?.company

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          companyId: activeCompany?.id || null,
          companyName: activeCompany?.name || null,
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.companyId = (user as { companyId?: string | null }).companyId
        token.companyName = (user as { companyName?: string | null }).companyName
      }
      // Handle company switch
      if (trigger === 'update' && session?.companyId) {
        token.companyId = session.companyId
        token.companyName = session.companyName
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.companyId = token.companyId
        session.user.companyName = token.companyName
      }
      return session
    },
  },
}
