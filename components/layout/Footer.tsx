"use client"

import { ThemeToggle } from "@/components/shared/ThemeToggle"
import { AdminService, onSnapshot } from "@/src/services"
import { useEffect, useState } from "react"
import Link from "next/link"
import { formatPrice } from "@/lib/utils"
import { Shield, MessageCircle, X } from "lucide-react"

interface SocialSettings {
  socialTwitterUrl: string
  socialInstagramUrl: string
  socialLinkedInUrl: string
  socialWhatsAppNumber: string
  contactEmail: string
}

const SOCIAL_DEFAULTS: SocialSettings = {
  socialTwitterUrl: "",
  socialInstagramUrl: "",
  socialLinkedInUrl: "",
  socialWhatsAppNumber: "2348000000000",
  contactEmail: "hello@zamorax.com",
}

export function Footer() {
  const [insuranceBalance, setInsuranceBalance] = useState(0)
  const [social, setSocial] = useState<SocialSettings>(SOCIAL_DEFAULTS)

  // Live insurance pool counter from Firestore
  useEffect(() => {
    const currentMonth = new Date().toISOString().slice(0, 7)
    const unsub = AdminService.subscribeToDoc("insurancePool", currentMonth, (snap) => {
      if (snap) setInsuranceBalance(snap?.netBalance || 0)
    })
    return () => unsub()
  }, [])

  // Load social links from platform settings (config/platform)
  useEffect(() => {
    AdminService.getDoc("config", "platform")
      .then(doc => {
        if (doc) {
          setSocial({
            socialTwitterUrl:     typeof doc.socialTwitterUrl     === "string" ? doc.socialTwitterUrl     : SOCIAL_DEFAULTS.socialTwitterUrl,
            socialInstagramUrl:   typeof doc.socialInstagramUrl   === "string" ? doc.socialInstagramUrl   : SOCIAL_DEFAULTS.socialInstagramUrl,
            socialLinkedInUrl:    typeof doc.socialLinkedInUrl    === "string" ? doc.socialLinkedInUrl    : SOCIAL_DEFAULTS.socialLinkedInUrl,
            socialWhatsAppNumber: typeof doc.socialWhatsAppNumber === "string" ? doc.socialWhatsAppNumber : SOCIAL_DEFAULTS.socialWhatsAppNumber,
            contactEmail:         typeof doc.contactEmail         === "string" ? doc.contactEmail         : SOCIAL_DEFAULTS.contactEmail,
          })
        }
      })
      .catch(() => {})
  }, [])

  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-secondary text-secondary-foreground pt-12 pb-20 md:pb-8">
      <div className="container grid gap-8 md:grid-cols-2 lg:grid-cols-4">
        {/* Brand */}
        <div className="space-y-4">
          <Link href="/" className="font-heading font-extrabold text-2xl tracking-tight text-white">
            ZAMORAX<span className="text-primary">.</span>
          </Link>
          <p className="text-sm text-secondary-foreground/70 max-w-xs">
            Buy, sell & rent across Nigeria. Verified sellers. Secure escrow. Delivered to your door.
          </p>
          <div className="flex items-center gap-2 text-xs text-accent/80 bg-accent/10 px-3 py-1.5 rounded-full w-fit">
            <Shield className="h-3 w-3" />
            <span>{formatPrice(insuranceBalance)} Protected This Month</span>
          </div>
        </div>

        {/* Links */}
        <div className="space-y-4">
          <h3 className="font-heading font-semibold text-white">Platform</h3>
          <ul className="space-y-2 text-sm">
            <li><Link href="/search"      className="hover:text-primary transition">Browse Listings</Link></li>
            <li><Link href="/pricing"     className="hover:text-primary transition">Pricing & Plans</Link></li>
            <li><Link href="/how-it-works"className="hover:text-primary transition">How It Works</Link></li>
            <li><Link href="/safety"      className="hover:text-primary transition">Safety Center</Link></li>
            <li><Link href="/blog"        className="hover:text-primary transition">Blog</Link></li>
          </ul>
        </div>

        {/* Legal */}
        <div className="space-y-4">
          <h3 className="font-heading font-semibold text-white">Legal</h3>
          <ul className="space-y-2 text-sm">
            <li><Link href="/privacy"  className="hover:text-primary transition">Privacy Policy</Link></li>
            <li><Link href="/terms"    className="hover:text-primary transition">Terms of Service</Link></li>
            <li><Link href="/contact"  className="hover:text-primary transition">Contact Support</Link></li>
            <li><Link href="/cookies"  className="hover:text-primary transition">Cookie Policy</Link></li>
          </ul>
        </div>

        {/* Social & Contact — driven by admin settings */}
        <div className="space-y-4">
          <h3 className="font-heading font-semibold text-white">Connect</h3>
          <div className="flex gap-4 flex-wrap">
            {/* X / Twitter */}
            {social.socialTwitterUrl ? (
              <a href={social.socialTwitterUrl} target="_blank" rel="noopener noreferrer"
                aria-label="X (Twitter)" className="hover:text-primary transition">
                <X className="h-5 w-5" />
              </a>
            ) : null}

            {/* Instagram */}
            {social.socialInstagramUrl ? (
              <a href={social.socialInstagramUrl} target="_blank" rel="noopener noreferrer"
                aria-label="Instagram" className="hover:text-primary transition">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 1.366.062 2.633.334 3.608 1.308.975.975 1.246 2.242 1.308 3.608.058 1.266.07 1.646.07 4.85s-.012 3.584-.07 4.85c-.062 1.366-.334 2.633-1.308 3.608-.975.975-2.242 1.246-3.608 1.308-1.266.058-1.646.07-4.85.07s-3.584-.012-4.85-.07c-1.366-.062-2.633-.334-3.608-1.308-.975-.975-1.246-2.242-1.308-3.608C2.175 15.584 2.163 15.204 2.163 12s.012-3.584.07-4.85c.062-1.366.334-2.633 1.308-3.608.975-.975 2.242-1.246 3.608-1.308C8.416 2.175 8.796 2.163 12 2.163zm0-2.163C8.741 0 8.333.014 7.053.072 5.775.13 4.602.402 3.635 1.368 2.668 2.335 2.396 3.508 2.338 4.786 2.28 6.066 2.266 6.474 2.266 12c0 5.526.014 5.934.072 7.214.058 1.278.33 2.451 1.297 3.418.967.967 2.14 1.239 3.418 1.297C8.333 23.986 8.741 24 12 24s3.667-.014 4.947-.072c1.278-.058 2.451-.33 3.418-1.297.967-.967 1.239-2.14 1.297-3.418.058-1.28.072-1.688.072-7.214 0-5.526-.014-5.934-.072-7.214-.058-1.278-.33-2.451-1.297-3.418C19.398.402 18.225.13 16.947.072 15.667.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zm0 10.162a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                </svg>
              </a>
            ) : null}

            {/* LinkedIn */}
            {social.socialLinkedInUrl ? (
              <a href={social.socialLinkedInUrl} target="_blank" rel="noopener noreferrer"
                aria-label="LinkedIn" className="hover:text-primary transition">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </a>
            ) : null}

            {/* WhatsApp — always shown, uses admin-set number */}
            <a
              href={`https://wa.me/${social.socialWhatsAppNumber}`}
              target="_blank" rel="noopener noreferrer"
              aria-label="WhatsApp Support"
              className="hover:text-primary transition"
            >
              <MessageCircle className="h-5 w-5" />
            </a>
          </div>

          <p className="text-xs text-secondary-foreground/60">{social.contactEmail}</p>
        </div>
      </div>

      <div className="container mt-8 border-t border-white/10 pt-6 text-center text-xs text-secondary-foreground/50">
        <div className="flex items-center justify-center gap-4">
          <p>&copy; {currentYear} Zamorax Enterprises Limited. RC9678731. All rights reserved.</p>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  )
}
