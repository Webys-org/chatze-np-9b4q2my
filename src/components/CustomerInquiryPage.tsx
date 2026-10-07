import React, { useState, useEffect } from 'react'
import {
  Store,
  ShieldCheck,
  Send,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Lock,
  ArrowRight,
  MapPin,
  MessageSquare,
} from 'lucide-react'

interface ShopProfile {
  displayName: string
  handle: string
  accountType: string
  bio: string
  businessCategory: string
  inquiryLetterboxEnabled: boolean
}

interface CustomerInquiryPageProps {
  shopHandle?: string
  onSwitchToOwnerLogin: () => void
}

export function CustomerInquiryPage({
  shopHandle = 'admin',
  onSwitchToOwnerLogin,
}: CustomerInquiryPageProps) {
  const [profile, setProfile] = useState<ShopProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [senderName, setSenderName] = useState('')
  const [senderContact, setSenderContact] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    async function loadShop() {
      try {
        const res = await fetch('/api/profile')
        if (res.ok) {
          const data = await res.json()
          if (data.profile) {
            setProfile(data.profile)
          }
        }
      } catch (e) {
        console.warn('Failed to load shop info', e)
      } finally {
        setLoading(false)
      }
    }
    loadShop()

    // Check if client has already submitted a note previously
    const existing = localStorage.getItem(`chatze_inq_${shopHandle}`)
    if (existing) {
      setSubmitted(true)
    }
  }, [shopHandle])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!noteContent.trim() || !senderName.trim()) return

    setSubmitting(true)
    setErrorMessage('')

    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopHandle,
          senderName: senderName.trim(),
          senderHandle: senderContact.trim() || senderName.toLowerCase().replace(/\s+/g, '_'),
          content: noteContent.trim(),
          senderOriginUrl: window.location.origin,
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setSubmitted(true)
        localStorage.setItem(`chatze_inq_${shopHandle}`, 'true')
      } else {
        setErrorMessage(data.error || 'Failed to submit inquiry')
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Network error while submitting note')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0b141a] text-[#e9edef] flex flex-col justify-between font-sans selection:bg-[#00a884]/30">
      {/* Top Header */}
      <header className="p-4 border-b border-[#202c33] bg-[#111b21]/70 backdrop-blur-md sticky top-0 z-20 flex items-center justify-between max-w-4xl w-full mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#00a884]/20 border border-[#00a884]/40 flex items-center justify-center text-[#00a884] font-bold text-xs">
            CZ
          </div>
          <span className="font-extrabold text-sm tracking-wide text-[#e9edef]">Chatze Nepal</span>
          <span className="text-[10px] bg-[#202c33] px-2 py-0.5 rounded-full text-[#8696a0] font-medium border border-[#222e35]">
            Verified Shop
          </span>
        </div>

        <button
          onClick={onSwitchToOwnerLogin}
          className="text-xs font-semibold text-[#8696a0] hover:text-[#00a884] transition-colors flex items-center gap-1 cursor-pointer"
        >
          <span>Shop Owner Login</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-lg w-full mx-auto p-4 sm:p-6 flex flex-col justify-center">
        {loading ? (
          <div className="py-16 text-center text-xs text-[#8696a0] space-y-2">
            <div className="w-6 h-6 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p>Connecting to Cloudflare Edge...</p>
          </div>
        ) : (
          <div className="bg-[#111b21] border border-[#202c33] rounded-2xl p-5 sm:p-6 shadow-2xl space-y-5">
            {/* Shop Profile Banner */}
            <div className="flex items-start gap-3.5 pb-4 border-b border-[#202c33]/70">
              <div className="w-13 h-13 rounded-2xl bg-[#00a884]/20 border border-[#00a884]/30 flex items-center justify-center font-bold text-base text-[#00a884] shrink-0">
                {(profile?.displayName || 'Chatze Shop').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold text-[#e9edef] truncate leading-snug">
                    {profile?.displayName || 'Chatze Shop'}
                  </h1>
                  <span title="Verified Independent Shop">
                    <ShieldCheck className="w-4 h-4 text-[#00a884] shrink-0" />
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#8696a0] mt-0.5">
                  <span className="text-[#00a884] font-medium">@{profile?.handle || shopHandle}</span>
                  <span>•</span>
                  <span className="truncate">{profile?.businessCategory || 'Store'}</span>
                </div>
                {profile?.bio && (
                  <p className="text-xs text-[#8696a0] mt-2 leading-relaxed bg-[#0b141a] p-2.5 rounded-xl border border-[#202c33]">
                    {profile.bio}
                  </p>
                )}
              </div>
            </div>

            {/* Letterbox Form or Lock State */}
            {submitted ? (
              <div className="p-4 bg-[#00a884]/15 border border-[#00a884]/30 rounded-xl space-y-3 text-center">
                <CheckCircle2 className="w-8 h-8 text-[#00a884] mx-auto" />
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-[#e9edef]">Inquiry Placed in Letterbox!</h3>
                  <p className="text-xs text-[#8696a0] leading-relaxed">
                    Your note has been safely dropped into the shop owner's inbox. To prevent spam, new notes are
                    locked until the owner reviews and replies.
                  </p>
                </div>
                <div className="pt-2 text-[11px] text-[#00a884] font-medium flex items-center justify-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>The owner will be alerted on their phone.</span>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-[#e9edef] flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-[#00a884]" /> Drop a Customer Note
                    </span>
                    <span className="text-[10px] text-[#8696a0] bg-[#0b141a] px-2 py-0.5 rounded border border-[#202c33]">
                      The 1-Card Gate
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8696a0]">
                    Ask about product availability, prices, or delivery. No registration required.
                  </p>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="font-semibold text-[#8696a0] block mb-1">Your Name</label>
                    <input
                      type="text"
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      placeholder="e.g. Aarav Sharma"
                      required
                      className="w-full px-3 py-2 bg-[#0b141a] border border-[#202c33] rounded-xl text-xs text-[#e9edef] placeholder-[#8696a0]/50 focus:outline-none focus:border-[#00a884]"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-[#8696a0] block mb-1">Contact (Phone or Email - optional)</label>
                    <input
                      type="text"
                      value={senderContact}
                      onChange={(e) => setSenderContact(e.target.value)}
                      placeholder="e.g. 98XXXXXXXX or email"
                      className="w-full px-3 py-2 bg-[#0b141a] border border-[#202c33] rounded-xl text-xs text-[#e9edef] placeholder-[#8696a0]/50 focus:outline-none focus:border-[#00a884]"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-[#8696a0] block mb-1">Message / Question</label>
                    <textarea
                      rows={3}
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="e.g. Dai, do you deliver to Pokhara? And do you have size L available?"
                      required
                      maxLength={500}
                      className="w-full px-3 py-2 bg-[#0b141a] border border-[#202c33] rounded-xl text-xs text-[#e9edef] placeholder-[#8696a0]/50 focus:outline-none focus:border-[#00a884] resize-none"
                    />
                    <div className="text-right text-[10px] text-[#8696a0] mt-0.5">
                      {noteContent.length}/500 chars
                    </div>
                  </div>
                </div>

                {errorMessage && (
                  <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !noteContent.trim() || !senderName.trim()}
                  className="w-full py-2.5 px-4 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-[#00a884]/20 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-[#111b21] border-t-transparent rounded-full animate-spin"></div>
                      <span>Placing note in Letterbox...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Customer Note (Drop in Box)</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Anti-Spam Security Notice */}
            <div className="pt-2 border-t border-[#202c33]/50 flex items-center justify-between text-[11px] text-[#8696a0]">
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3 text-[#00a884]" />
                Protected by Anti-Spam Shield
              </span>
              <span>1 Note per Sender</span>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="p-4 border-t border-[#202c33] text-center text-xs text-[#8696a0]">
        Powered by <strong className="text-[#e9edef]">Chatze</strong> • Nepal First Edge Chat Architecture 🇳🇵
      </footer>
    </div>
  )
}
