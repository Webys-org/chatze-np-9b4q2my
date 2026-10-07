import React, { useState, useEffect } from 'react'
import {
  X,
  User,
  Store,
  Shield,
  KeyRound,
  QrCode,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  Globe,
  Bell,
  Lock,
  Layers,
  Save,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react'

export interface ProfileData {
  displayName: string
  handle: string
  accountType: 'personal' | 'business'
  bio: string
  businessCategory: string
  privacyMode: 'open' | 'pin_only' | 'closed'
  friendPin: string
  inquiryLetterboxEnabled: boolean
  instanceUrl: string
}

interface ProfileSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  currentUser: { id: string; handle: string; display_name: string; role?: string }
  onProfileUpdated?: (updated: { displayName: string; accountType: 'personal' | 'business' }) => void
}

const BUSINESS_CATEGORIES = [
  'General & Personal Shop',
  'Clothing, Fashion & Apparel',
  'Restaurant, Cafe & Bakery',
  'Electronics, Mobiles & Tech',
  'Grocery, Kirana & Organics',
  'Handicrafts, Art & Culture',
  'Services, Freelance & Agency',
  'Hotel, Travel & Tourism',
]

export function ProfileSettingsModal({
  isOpen,
  onClose,
  currentUser,
  onProfileUpdated,
}: ProfileSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'account' | 'privacy' | 'edge'>('account')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Profile Form State
  const [displayName, setDisplayName] = useState(currentUser.display_name || '')
  const [handle, setHandle] = useState(currentUser.handle || 'admin')
  const [accountType, setAccountType] = useState<'personal' | 'business'>('personal')
  const [bio, setBio] = useState('')
  const [businessCategory, setBusinessCategory] = useState('General & Personal Shop')
  const [privacyMode, setPrivacyMode] = useState<'open' | 'pin_only' | 'closed'>('pin_only')
  const [friendPin, setFriendPin] = useState('')
  const [inquiryLetterboxEnabled, setInquiryLetterboxEnabled] = useState(true)
  const [instanceUrl, setInstanceUrl] = useState('')

  // Copy feedbacks
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedPin, setCopiedPin] = useState(false)
  const [regeneratingPin, setRegeneratingPin] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    async function fetchProfile() {
      setLoading(true)
      setErrorMsg('')
      try {
        const res = await fetch('/api/profile')
        if (res.ok) {
          const data = await res.json()
          if (data.profile) {
            setDisplayName(data.profile.displayName || currentUser.display_name)
            setHandle(data.profile.handle || currentUser.handle)
            setAccountType(data.profile.accountType || 'personal')
            setBio(data.profile.bio || '')
            setBusinessCategory(data.profile.businessCategory || 'General & Personal Shop')
            setPrivacyMode(data.profile.privacyMode || 'pin_only')
            setFriendPin(data.profile.friendPin || '')
            setInquiryLetterboxEnabled(data.profile.inquiryLetterboxEnabled !== false)
            setInstanceUrl(data.profile.instanceUrl || window.location.origin)
          }
        }
      } catch (err: any) {
        console.warn('Profile fetch warning', err?.message)
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [isOpen, currentUser])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrorMsg('')
    setSaveSuccess(false)

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          accountType,
          bio: bio.trim(),
          businessCategory,
          privacyMode,
          friendPin,
          inquiryLetterboxEnabled,
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setSaveSuccess(true)
        if (onProfileUpdated) {
          onProfileUpdated({
            displayName: data.profile.displayName,
            accountType: data.profile.accountType,
          })
        }
        setTimeout(() => setSaveSuccess(false), 3000)
      } else {
        setErrorMsg(data.error || 'Failed to save settings')
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error while saving')
    } finally {
      setSaving(false)
    }
  }

  const handleRegeneratePin = async () => {
    setRegeneratingPin(true)
    try {
      const res = await fetch('/api/profile/pin/regenerate', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.friendPin) {
        setFriendPin(data.friendPin)
      }
    } catch {}
    setRegeneratingPin(false)
  }

  const inviteLink = `${instanceUrl || window.location.origin}/?add=@${handle}&pin=${friendPin}`
  const shopInquiryLink = `${instanceUrl || window.location.origin}/shop/@${handle}`

  const copyToClipboard = (text: string, type: 'link' | 'pin') => {
    navigator.clipboard.writeText(text).then(() => {
      if (type === 'link') {
        setCopiedLink(true)
        setTimeout(() => setCopiedLink(false), 2000)
      } else {
        setCopiedPin(true)
        setTimeout(() => setCopiedPin(false), 2000)
      }
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans">
      <div className="w-full max-w-xl bg-[#111b21] border border-[#202c33] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Top Header */}
        <div className="p-4 bg-[#202c33]/60 border-b border-[#202c33] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#00a884]/20 border border-[#00a884]/30 flex items-center justify-center text-[#00a884]">
              {accountType === 'business' ? <Store className="w-5 h-5" /> : <User className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#e9edef] leading-tight">Profile & Account Settings</h2>
              <p className="text-[11px] text-[#8696a0]">Customize your profile, account type & anti-spam privacy</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#e9edef] hover:bg-[#202c33] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[#202c33] bg-[#0b141a]/60 px-4 pt-2 gap-2 shrink-0 text-xs">
          <button
            onClick={() => setActiveTab('account')}
            className={`pb-2.5 px-3 font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'account'
                ? 'border-[#00a884] text-[#00a884]'
                : 'border-transparent text-[#8696a0] hover:text-[#e9edef]'
            }`}
          >
            <User className="w-3.5 h-3.5" /> Identity & Profile
          </button>
          <button
            onClick={() => setActiveTab('privacy')}
            className={`pb-2.5 px-3 font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'privacy'
                ? 'border-[#00a884] text-[#00a884]'
                : 'border-transparent text-[#8696a0] hover:text-[#e9edef]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" /> Privacy & Anti-Spam
          </button>
          <button
            onClick={() => setActiveTab('edge')}
            className={`pb-2.5 px-3 font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'edge'
                ? 'border-[#00a884] text-[#00a884]'
                : 'border-transparent text-[#8696a0] hover:text-[#e9edef]'
            }`}
          >
            <Globe className="w-3.5 h-3.5" /> Edge & Node Info
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-xs text-[#8696a0] gap-2">
              <div className="w-6 h-6 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
              <span>Loading your profile settings...</span>
            </div>
          ) : (
            <form id="profile-form" onSubmit={handleSave} className="space-y-4">
              {/* TAB 1: IDENTITY & PROFILE */}
              {activeTab === 'account' && (
                <div className="space-y-4 text-xs">
                  {/* Account Type Selector Card */}
                  <div className="p-3.5 bg-[#0b141a] border border-[#202c33] rounded-xl space-y-3">
                    <label className="font-bold text-[#e9edef] block text-[11px] uppercase tracking-wider text-[#8696a0]">
                      Account Type (Nepal First Mode)
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setAccountType('personal')}
                        className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1.5 ${
                          accountType === 'personal'
                            ? 'bg-[#00a884]/15 border-[#00a884] text-[#e9edef]'
                            : 'bg-[#111b21] border-[#202c33] text-[#8696a0] hover:border-[#8696a0]/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs flex items-center gap-1.5 text-[#e9edef]">
                            <User className="w-3.5 h-3.5 text-[#00a884]" /> Personal Account
                          </span>
                          {accountType === 'personal' && <Check className="w-3.5 h-3.5 text-[#00a884]" />}
                        </div>
                        <p className="text-[10px] text-[#8696a0] leading-snug">
                          For individual chatting, friends & family. Protected with private Friend PIN.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAccountType('business')}
                        className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1.5 ${
                          accountType === 'business'
                            ? 'bg-amber-500/15 border-amber-500 text-[#e9edef]'
                            : 'bg-[#111b21] border-[#202c33] text-[#8696a0] hover:border-[#8696a0]/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs flex items-center gap-1.5 text-[#e9edef]">
                            <Store className="w-3.5 h-3.5 text-amber-400" /> Business / Shop
                          </span>
                          {accountType === 'business' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                        </div>
                        <p className="text-[10px] text-[#8696a0] leading-snug">
                          For pasals, brands & freelancers. Activates customer inquiry letterbox.
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Display Name */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-[#8696a0]">
                      {accountType === 'business' ? 'Shop / Brand Name' : 'Your Display Name'}
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={accountType === 'business' ? 'e.g. Kathmandu Threads' : 'e.g. Aarav Sharma'}
                      required
                      className="w-full px-3 py-2 bg-[#0b141a] border border-[#202c33] rounded-xl text-xs text-[#e9edef] placeholder-[#8696a0]/60 focus:outline-none focus:border-[#00a884]"
                    />
                  </div>

                  {/* Handle (Read-only instance handle) */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-[#8696a0]">Handle (@Username)</label>
                    <div className="flex items-center px-3 py-2 bg-[#0b141a]/60 border border-[#202c33] rounded-xl text-xs text-[#8696a0]">
                      <span className="text-[#00a884] font-bold mr-1">@</span>
                      <span>{handle}</span>
                      <span className="ml-auto text-[10px] bg-[#202c33] px-2 py-0.5 rounded text-[#8696a0]">
                        Primary Admin
                      </span>
                    </div>
                  </div>

                  {/* Business Category (Only when business) */}
                  {accountType === 'business' && (
                    <div className="space-y-1.5">
                      <label className="font-semibold text-amber-400">Business Category</label>
                      <select
                        value={businessCategory}
                        onChange={(e) => setBusinessCategory(e.target.value)}
                        className="w-full px-3 py-2 bg-[#0b141a] border border-[#202c33] rounded-xl text-xs text-[#e9edef] focus:outline-none focus:border-amber-400"
                      >
                        {BUSINESS_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat} className="bg-[#111b21] text-[#e9edef]">
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Bio / Tagline */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-[#8696a0]">
                      {accountType === 'business' ? 'Shop Description / Delivery Notice' : 'Bio / Status'}
                    </label>
                    <textarea
                      rows={2}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder={
                        accountType === 'business'
                          ? 'e.g. Premium winter streetwear. Delivery all across Nepal (eSewa / COD).'
                          : 'e.g. Available for coffee in Thamel. Ping me anytime.'
                      }
                      className="w-full px-3 py-2 bg-[#0b141a] border border-[#202c33] rounded-xl text-xs text-[#e9edef] placeholder-[#8696a0]/60 focus:outline-none focus:border-[#00a884] resize-none"
                    />
                  </div>
                </div>
              )}

              {/* TAB 2: PRIVACY & ANTI-SPAM */}
              {activeTab === 'privacy' && (
                <div className="space-y-4 text-xs">
                  {/* Personal Friend PIN Card */}
                  <div className="p-4 bg-[#0b141a] border border-[#202c33] rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-[#00a884]" />
                        <span className="font-bold text-[#e9edef]">Personal Friend PIN</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleRegeneratePin}
                        disabled={regeneratingPin}
                        className="flex items-center gap-1 text-[11px] text-[#8696a0] hover:text-[#00a884] transition-colors"
                      >
                        <RefreshCw className={`w-3 h-3 ${regeneratingPin ? 'animate-spin' : ''}`} />
                        <span>Change PIN</span>
                      </button>
                    </div>

                    <p className="text-[11px] text-[#8696a0]">
                      Give this PIN to friends you trust. When Privacy Mode is set to <strong>PIN Only</strong>,
                      strangers and bots cannot send you friend requests without it.
                    </p>

                    <div className="flex items-center gap-2 p-2.5 bg-[#111b21] border border-[#202c33] rounded-xl">
                      <span className="font-mono text-base font-extrabold tracking-widest text-[#00a884] pl-2">
                        {friendPin || 'NP-7429'}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(friendPin, 'pin')}
                        className="ml-auto px-3 py-1 bg-[#202c33] hover:bg-[#2a3942] text-xs font-semibold rounded-lg text-[#e9edef] flex items-center gap-1.5 transition-all"
                      >
                        {copiedPin ? <Check className="w-3.5 h-3.5 text-[#00a884]" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedPin ? 'Copied' : 'Copy PIN'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Privacy Mode Selector */}
                  <div className="space-y-2">
                    <label className="font-bold text-[#8696a0] block text-[11px] uppercase tracking-wider">
                      Who Can Send You Friend Requests?
                    </label>
                    <div className="space-y-2">
                      <label
                        className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                          privacyMode === 'pin_only'
                            ? 'bg-[#00a884]/10 border-[#00a884]'
                            : 'bg-[#0b141a] border-[#202c33] hover:border-[#8696a0]/40'
                        }`}
                      >
                        <input
                          type="radio"
                          name="privacyMode"
                          value="pin_only"
                          checked={privacyMode === 'pin_only'}
                          onChange={() => setPrivacyMode('pin_only')}
                          className="mt-0.5 accent-[#00a884]"
                        />
                        <div className="space-y-0.5">
                          <span className="font-bold text-[#e9edef] block">
                            🔒 PIN Protected (Recommended for Nepal)
                          </span>
                          <span className="text-[11px] text-[#8696a0] block">
                            Only people who have your 6-digit PIN or scan your QR code can add you. Blocks 100% of blind bots.
                          </span>
                        </div>
                      </label>

                      <label
                        className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                          privacyMode === 'open'
                            ? 'bg-[#00a884]/10 border-[#00a884]'
                            : 'bg-[#0b141a] border-[#202c33] hover:border-[#8696a0]/40'
                        }`}
                      >
                        <input
                          type="radio"
                          name="privacyMode"
                          value="open"
                          checked={privacyMode === 'open'}
                          onChange={() => setPrivacyMode('open')}
                          className="mt-0.5 accent-[#00a884]"
                        />
                        <div className="space-y-0.5">
                          <span className="font-bold text-[#e9edef] block">
                            🌐 Open Federation (Public Search)
                          </span>
                          <span className="text-[11px] text-[#8696a0] block">
                            Anyone who knows your @handle can send a friend request. (Subject to max 5 pending queue cap).
                          </span>
                        </div>
                      </label>

                      <label
                        className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                          privacyMode === 'closed'
                            ? 'bg-[#00a884]/10 border-[#00a884]'
                            : 'bg-[#0b141a] border-[#202c33] hover:border-[#8696a0]/40'
                        }`}
                      >
                        <input
                          type="radio"
                          name="privacyMode"
                          value="closed"
                          checked={privacyMode === 'closed'}
                          onChange={() => setPrivacyMode('closed')}
                          className="mt-0.5 accent-[#00a884]"
                        />
                        <div className="space-y-0.5">
                          <span className="font-bold text-[#e9edef] block">
                            🚫 Closed / Incognito
                          </span>
                          <span className="text-[11px] text-[#8696a0] block">
                            Reject all incoming friend requests automatically. You can still send outbound requests.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Business Letterbox Toggle (For business accounts) */}
                  {accountType === 'business' && (
                    <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-400">Customer Inquiries Letterbox</span>
                        <input
                          type="checkbox"
                          checked={inquiryLetterboxEnabled}
                          onChange={(e) => setInquiryLetterboxEnabled(e.target.checked)}
                          className="w-4 h-4 accent-[#00a884] cursor-pointer"
                        />
                      </div>
                      <p className="text-[11px] text-[#8696a0]">
                        Allows customers on the internet to drop 1 inquiry note (e.g. asking product prices) into your
                        queue without ringing your server or sending spam floods.
                      </p>
                    </div>
                  )}

                  {/* Copy Invite Link */}
                  <div className="p-3 bg-[#0b141a] border border-[#202c33] rounded-xl space-y-2">
                    <span className="font-bold text-[#e9edef] block">
                      {accountType === 'business' ? 'Your Public Shop Link' : 'Your Personal Add-Me Link'}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={accountType === 'business' ? shopInquiryLink : inviteLink}
                        className="flex-1 px-2.5 py-1.5 bg-[#111b21] border border-[#202c33] rounded-lg text-[11px] text-[#8696a0] font-mono select-all"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(accountType === 'business' ? shopInquiryLink : inviteLink, 'link')}
                        className="px-3 py-1.5 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] font-bold rounded-lg text-xs flex items-center gap-1 shrink-0"
                      >
                        {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: EDGE CLOUD & NODE INFO */}
              {activeTab === 'edge' && (
                <div className="space-y-3 text-xs">
                  <div className="p-3.5 bg-[#0b141a] border border-[#202c33] rounded-xl space-y-2.5">
                    <span className="font-bold text-[#e9edef] block text-[11px] uppercase tracking-wider text-[#8696a0]">
                      Cloudflare Edge Status
                    </span>
                    <div className="space-y-2 text-[11px]">
                      <div className="flex items-center justify-between py-1 border-b border-[#202c33]/40">
                        <span className="text-[#8696a0]">Edge PoP Region:</span>
                        <span className="font-semibold text-[#00a884] flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#00a884] animate-pulse"></span>
                          Kathmandu (KTM) / Edge Network
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-1 border-b border-[#202c33]/40">
                        <span className="text-[#8696a0]">D1 SQLite Database:</span>
                        <span className="font-semibold text-[#e9edef]">Active (5 GB Edge Native)</span>
                      </div>
                      <div className="flex items-center justify-between py-1 border-b border-[#202c33]/40">
                        <span className="text-[#8696a0]">WebPush VAPID Keypair:</span>
                        <span className="font-semibold text-[#00a884]">P-256 Verified in .env</span>
                      </div>
                      <div className="flex items-center justify-between py-1 border-b border-[#202c33]/40">
                        <span className="text-[#8696a0]">Daily Worker Quota:</span>
                        <span className="font-semibold text-[#e9edef]">100,000 Free Invocations/Day</span>
                      </div>
                      <div className="flex items-center justify-between py-1">
                        <span className="text-[#8696a0]">Anti-Spam Security Shield:</span>
                        <span className="font-semibold text-[#00a884]">Active (eTLD+1 Root Protection)</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-[#00a884]/10 border border-[#00a884]/20 rounded-xl space-y-1 text-[11px] text-[#e9edef]">
                    <span className="font-bold flex items-center gap-1 text-[#00a884]">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 100% Data Sovereignty
                    </span>
                    <p className="text-[#8696a0] leading-relaxed">
                      Your messages, contacts, and images stay completely inside your private Cloudflare D1 database.
                      No central company can read or sell your chat history.
                    </p>
                  </div>
                </div>
              )}

              {/* Status Message */}
              {errorMsg && (
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {saveSuccess && (
                <div className="p-2.5 bg-[#00a884]/15 border border-[#00a884]/30 rounded-xl text-[#00a884] text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Settings saved successfully!</span>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 bg-[#202c33]/60 border-t border-[#202c33] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[#8696a0]">
            Mode: <strong className="text-[#e9edef] capitalize">{accountType}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 bg-[#202c33] hover:bg-[#2a3942] text-[#8696a0] hover:text-[#e9edef] rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="profile-form"
              disabled={saving || loading}
              className="px-4 py-1.5 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-[#00a884]/20 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-[#111b21] border-t-transparent rounded-full animate-spin"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
