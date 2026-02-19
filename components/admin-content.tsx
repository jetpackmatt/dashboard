'use client'

import * as React from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  Plus,
  Pencil,
  Trash2,
  History,
  FileText,
  Percent,
  DollarSign,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Send,
  Eye,
  Download,
  CalendarIcon,
  RotateCcw,
  FileSpreadsheet,
  XCircle,
  Activity,
  CreditCard,
  Building2,
  Settings,
  Key,
  MapPin,
  Mail,
  Phone,
  User,
  X,
  Search,
  Warehouse,
  Save,
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  BarChart3,
  ExternalLink,
} from 'lucide-react'
import { JetpackLoader } from '@/components/jetpack-loader'
import { SiteHeader } from '@/components/site-header'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useClient } from '@/components/client-context'
import { FEE_TYPE_CATEGORIES, WEIGHT_BRACKETS } from '@/lib/billing/types'
import type { MarkupRuleFormData } from '@/lib/billing/types'

/**
 * Format a date string as a fixed date without timezone conversion.
 * This prevents dates from shifting due to local timezone interpretation.
 * Input: '2025-11-24' or '2025-11-24T05:00:00.000Z'
 * Output: '11/24/2025'
 */
function formatDateFixed(dateStr: string): string {
  // Extract just the YYYY-MM-DD part (handles both date-only and ISO strings)
  const datePart = dateStr.split('T')[0]
  const [year, month, day] = datePart.split('-')
  return `${parseInt(month)}/${parseInt(day)}/${year}`
}

interface MarkupRule {
  id: string
  client_id: string | null
  name: string
  fee_type: string | null
  billing_category: string | null
  order_category: string | null
  ship_option_id: string | null
  conditions: Record<string, unknown> | null
  markup_type: 'percentage' | 'fixed'
  markup_value: number
  priority: number
  is_additive: boolean
  effective_from: string
  effective_to: string | null
  is_active: boolean
  description: string | null
  created_at: string
}

interface Client {
  id: string
  company_name: string
  merchant_id?: string | null
  eshipper_id?: string | null
  gofo_id?: string | null
  short_code?: string | null
  has_token?: boolean
  stripe_customer_id?: string | null
  stripe_payment_method_id?: string | null
}

interface JetpackInvoice {
  id: string
  client_id: string
  invoice_number: string
  invoice_date: string
  period_start: string
  period_end: string
  subtotal: number
  total_markup: number
  total_amount: number
  status: string
  paid_status: string
  generated_at: string
  approved_at: string | null
  version: number
  email_sent_at: string | null
  email_error: string | null
  client?: Client
  line_items_json?: Array<{ feeType?: string; [key: string]: unknown }>
}

interface RuleHistoryEntry {
  id: string
  markup_rule_id: string
  changed_by: string | null
  change_type: 'created' | 'updated' | 'deactivated'
  previous_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  change_reason: string | null
  changed_at: string
}

export function AdminContent() {
  const { clients, isLoading: isClientLoading } = useClient()

  // Tab state with URL persistence - using Next.js hooks
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const validTabs = ['markup', 'invoicing', 'brands', 'disputes', 'orphans', 'sync-health', 'warehouses', 'care-team']
  const tabFromUrl = searchParams.get('tab')
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'markup'
  const [activeTab, setActiveTab] = React.useState(initialTab)

  // Sync tab to URL when it changes
  const handleTabChange = React.useCallback((newTab: string) => {
    setActiveTab(newTab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', newTab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams, router, pathname])

  return (
    <>
    <SiteHeader sectionName="Admin">
      {isClientLoading && (
        <div className="flex items-center gap-1.5 ml-[10px]">
          <JetpackLoader size="md" />
          <span className="text-xs text-muted-foreground">Loading</span>
        </div>
      )}
    </SiteHeader>
    <div className="p-4 lg:p-6">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList>
          <TabsTrigger value="markup">Markups</TabsTrigger>
          <TabsTrigger value="invoicing">Invoicing</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="disputes">Disputes</TabsTrigger>
          <TabsTrigger value="orphans">Orphans</TabsTrigger>
          <TabsTrigger value="sync-health">Sync Health</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="care-team">Care Team</TabsTrigger>
          <TabsTrigger value="commissions">Commissions</TabsTrigger>
          <TabsTrigger value="delivery-iq" asChild>
            <a href="/dashboard/admin/delivery-iq" className="inline-flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4" />
              Delivery IQ
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          </TabsTrigger>
        </TabsList>

        {/* Markup Tables Tab */}
        <TabsContent value="markup" className="space-y-6">
          <MarkupTablesContent clients={clients} />
        </TabsContent>

        {/* Run Invoicing Tab */}
        <TabsContent value="invoicing" className="space-y-6">
          <InvoicingContent clients={clients} />
        </TabsContent>

        {/* Brands Tab */}
        <TabsContent value="brands" className="space-y-6">
          <BrandsContent clients={clients} />
        </TabsContent>

        {/* Disputes Tab */}
        <TabsContent value="disputes" className="space-y-6">
          <DisputesContent />
        </TabsContent>

        {/* Orphans Tab */}
        <TabsContent value="orphans" className="space-y-6">
          <OrphansContent clients={clients} />
        </TabsContent>

        {/* Sync Health Tab */}
        <TabsContent value="sync-health" className="space-y-6">
          <SyncHealthContent />
        </TabsContent>

        {/* Warehouses Tab */}
        <TabsContent value="warehouses" className="space-y-6">
          <WarehousesContent />
        </TabsContent>

        {/* Care Team Tab */}
        <TabsContent value="care-team" className="space-y-6">
          <CareTeamContent />
        </TabsContent>

        {/* Commissions Tab */}
        <TabsContent value="commissions" className="space-y-6">
          <CommissionsContent clients={clients} />
        </TabsContent>
      </Tabs>
    </div>
    </>
  )
}

// ============================================
// Markup Tables Tab Content
// ============================================

function MarkupTablesContent({ clients }: { clients: Client[] }) {
  const [rules, setRules] = React.useState<MarkupRule[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editingRule, setEditingRule] = React.useState<MarkupRule | null>(null)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [expandedClients, setExpandedClients] = React.useState<Set<string>>(new Set(['global']))
  const [historyRule, setHistoryRule] = React.useState<MarkupRule | null>(null)
  const [historyEntries, setHistoryEntries] = React.useState<RuleHistoryEntry[]>([])
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = React.useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false)

  // Fetch markup rules
  React.useEffect(() => {
    fetchRules()
  }, [])

  async function fetchRules() {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/markup-rules')
      if (!response.ok) throw new Error('Failed to fetch markup rules')
      const data = await response.json()
      setRules(data.rules || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules')
    } finally {
      setIsLoading(false)
    }
  }

  // Group rules by client
  const rulesByClient = React.useMemo(() => {
    const grouped: Record<string, MarkupRule[]> = { global: [] }

    for (const client of clients) {
      grouped[client.id] = []
    }

    for (const rule of rules) {
      if (rule.client_id === null) {
        grouped.global.push(rule)
      } else if (grouped[rule.client_id]) {
        grouped[rule.client_id].push(rule)
      }
    }

    return grouped
  }, [rules, clients])

  function toggleClient(clientId: string) {
    setExpandedClients(prev => {
      const next = new Set(prev)
      if (next.has(clientId)) {
        next.delete(clientId)
      } else {
        next.add(clientId)
      }
      return next
    })
  }

  function handleAddRule(clientId: string | null) {
    setEditingRule({
      id: '',
      client_id: clientId,
      name: '',
      fee_type: null,
      billing_category: null,
      order_category: null,
      ship_option_id: null,
      conditions: null,
      markup_type: 'percentage',
      markup_value: 0,
      priority: 0,
      is_additive: true,
      effective_from: new Date().toISOString().split('T')[0],
      effective_to: null,
      is_active: true,
      description: null,
      created_at: '',
    })
    setIsDialogOpen(true)
  }

  function handleEditRule(rule: MarkupRule) {
    setEditingRule(rule)
    setIsDialogOpen(true)
  }

  async function handleSaveRule(formData: MarkupRuleFormData) {
    try {
      const isNew = !editingRule?.id
      const response = await fetch(
        isNew ? '/api/admin/markup-rules' : `/api/admin/markup-rules/${editingRule?.id}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save rule')
      }

      await fetchRules()
      setIsDialogOpen(false)
      setEditingRule(null)
    } catch (err) {
      throw err
    }
  }

  async function handleDeactivateRule(ruleId: string, reason: string) {
    try {
      const response = await fetch(`/api/admin/markup-rules/${ruleId}/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })

      if (!response.ok) throw new Error('Failed to deactivate rule')

      await fetchRules()
    } catch (err) {
      console.error('Error deactivating rule:', err)
    }
  }

  async function handleViewHistory(rule: MarkupRule) {
    setHistoryRule(rule)
    setIsHistoryDialogOpen(true)
    setIsLoadingHistory(true)
    setHistoryEntries([])

    try {
      const response = await fetch(`/api/admin/markup-rules/${rule.id}`)
      if (!response.ok) throw new Error('Failed to fetch history')
      const data = await response.json()
      setHistoryEntries(data.history || [])
    } catch (err) {
      console.error('Error fetching history:', err)
    } finally {
      setIsLoadingHistory(false)
    }
  }

  if (isLoading) return null

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={fetchRules}>Try Again</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Markup Rules</h2>
          <p className="text-sm text-muted-foreground">
            Configure markup percentages and fixed fees for billing transactions
          </p>
        </div>
        <Button onClick={() => handleAddRule(null)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Global Rule
        </Button>
      </div>

      {/* Global Rules */}
      <RuleSection
        title="Global Rules (All Clients)"
        rules={rulesByClient.global}
        isExpanded={expandedClients.has('global')}
        onToggle={() => toggleClient('global')}
        onAddRule={() => handleAddRule(null)}
        onEditRule={handleEditRule}
        onDeactivateRule={handleDeactivateRule}
        onViewHistory={handleViewHistory}
      />

      {/* Per-Client Rules */}
      {clients.map(client => (
        <RuleSection
          key={client.id}
          title={client.company_name}
          subtitle={client.short_code ? `(${client.short_code})` : undefined}
          rules={rulesByClient[client.id] || []}
          isExpanded={expandedClients.has(client.id)}
          onToggle={() => toggleClient(client.id)}
          onAddRule={() => handleAddRule(client.id)}
          onEditRule={handleEditRule}
          onDeactivateRule={handleDeactivateRule}
          onViewHistory={handleViewHistory}
        />
      ))}

      {/* Edit/Add Dialog */}
      <MarkupRuleDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        rule={editingRule}
        clients={clients}
        existingRules={rules}
        onSave={handleSaveRule}
      />

      {/* History Dialog */}
      <MarkupHistoryDialog
        open={isHistoryDialogOpen}
        onOpenChange={setIsHistoryDialogOpen}
        rule={historyRule}
        history={historyEntries}
        isLoading={isLoadingHistory}
      />
    </>
  )
}

// Rule section component
function RuleSection({
  title,
  subtitle,
  rules,
  isExpanded,
  onToggle,
  onAddRule,
  onEditRule,
  onDeactivateRule,
  onViewHistory,
}: {
  title: string
  subtitle?: string
  rules: MarkupRule[]
  isExpanded: boolean
  onToggle: () => void
  onAddRule: () => void
  onEditRule: (rule: MarkupRule) => void
  onDeactivateRule: (ruleId: string, reason: string) => void
  onViewHistory: (rule: MarkupRule) => void
}) {
  const activeRules = rules.filter(r => r.is_active)
  const inactiveRules = rules.filter(r => !r.is_active)

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <CardTitle className="text-base">
                  {title}
                  {subtitle && (
                    <span className="text-muted-foreground font-normal ml-2">
                      {subtitle}
                    </span>
                  )}
                </CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{activeRules.length} active</Badge>
                {inactiveRules.length > 0 && (
                  <Badge variant="outline">{inactiveRules.length} inactive</Badge>
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            {activeRules.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No active rules configured</p>
                <Button variant="outline" className="mt-4 gap-2" onClick={onAddRule}>
                  <Plus className="h-4 w-4" />
                  Add Rule
                </Button>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fee Type</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Markup</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeRules.map(rule => {
                      // Build conditions display
                      const conditionParts: string[] = []
                      if (rule.ship_option_id) {
                        conditionParts.push(`Ship ${rule.ship_option_id}`)
                      }
                      const conditions = rule.conditions as { weight_min_oz?: number; weight_max_oz?: number } | null
                      if (conditions?.weight_min_oz !== undefined) {
                        const bracket = WEIGHT_BRACKETS.find(b => b.minOz === conditions.weight_min_oz)
                        if (bracket) conditionParts.push(bracket.label)
                      }

                      return (
                      <TableRow key={rule.id}>
                        <TableCell className="font-medium">
                          <div>
                            {rule.fee_type || 'All Types'}
                            {conditionParts.length > 0 && (
                              <span className="text-muted-foreground text-xs block">
                                {conditionParts.join(' | ')}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {rule.billing_category || 'All'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {rule.markup_type === 'percentage' ? (
                            <span className="flex items-center gap-1">
                              <Percent className="h-3 w-3" />
                              {rule.markup_value}%
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <DollarSign className="h-3 w-3" />
                              ${rule.markup_value.toFixed(2)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateFixed(rule.effective_from)}
                          {rule.effective_to && (
                            <> - {formatDateFixed(rule.effective_to)}</>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Edit Rule"
                              onClick={() => onEditRule(rule)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="View History"
                              onClick={() => onViewHistory(rule)}
                            >
                              <History className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Deactivate Rule"
                              onClick={() => {
                                const reason = prompt('Reason for deactivating this rule:')
                                if (reason) onDeactivateRule(rule.id, reason)
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )})}
                  </TableBody>
                </Table>
                <div className="mt-4">
                  <Button variant="outline" size="sm" className="gap-2" onClick={onAddRule}>
                    <Plus className="h-4 w-4" />
                    Add Rule
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

// Markup Rule Dialog
function MarkupRuleDialog({
  open,
  onOpenChange,
  rule,
  clients,
  existingRules,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule: MarkupRule | null
  clients: Client[]
  existingRules: MarkupRule[]
  onSave: (data: MarkupRuleFormData) => Promise<void>
}) {
  const [formData, setFormData] = React.useState<MarkupRuleFormData>({
    name: '',
    client_id: null,
    billing_category: '',
    fee_type: null,
    order_category: null,
    ship_option_id: null,
    markup_type: 'percentage',
    markup_value: 0,
    priority: 0,
    is_additive: true,
    effective_from: new Date().toISOString().split('T')[0],
    effective_to: null,
    description: null,
    conditions: null,
  })
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Reset form when rule changes
  React.useEffect(() => {
    if (rule) {
      setFormData({
        name: rule.name,
        client_id: rule.client_id,
        billing_category: rule.billing_category || '',
        fee_type: rule.fee_type,
        order_category: rule.order_category,
        ship_option_id: rule.ship_option_id,
        markup_type: rule.markup_type,
        markup_value: rule.markup_value,
        priority: rule.priority,
        is_additive: rule.is_additive,
        effective_from: rule.effective_from,
        effective_to: rule.effective_to,
        description: rule.description,
        conditions: rule.conditions as MarkupRuleFormData['conditions'],
      })
    }
    setError(null)
  }, [rule])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSaving(true)
    setError(null)

    try {
      // Validate required fields
      if (!formData.billing_category || !formData.fee_type) {
        throw new Error('Category and Fee Type are required')
      }

      // Check for duplicate - must match fee_type, ship_option_id, AND weight conditions
      const duplicateRule = existingRules.find(r => {
        if (r.id === rule?.id) return false
        if (r.client_id !== formData.client_id) return false
        if (r.fee_type !== formData.fee_type) return false
        if (!r.is_active) return false

        // Also compare ship_option_id and weight conditions
        if (r.ship_option_id !== formData.ship_option_id) return false

        // Compare weight conditions
        const existingMinOz = (r.conditions as any)?.weight_min_oz
        const existingMaxOz = (r.conditions as any)?.weight_max_oz
        const newMinOz = formData.conditions?.weight_min_oz
        const newMaxOz = formData.conditions?.weight_max_oz

        if (existingMinOz !== newMinOz || existingMaxOz !== newMaxOz) return false

        return true // All conditions match - this is a duplicate
      })
      if (duplicateRule) {
        const details = []
        if (formData.ship_option_id) details.push(`Ship Option ${formData.ship_option_id}`)
        if (formData.conditions?.weight_min_oz !== undefined) {
          const bracket = WEIGHT_BRACKETS.find(b => b.minOz === formData.conditions?.weight_min_oz)
          if (bracket) details.push(bracket.label)
        }
        const suffix = details.length > 0 ? ` (${details.join(', ')})` : ''
        throw new Error(`A rule for "${formData.fee_type}${suffix}" already exists for this client`)
      }

      // Auto-generate name from fee_type + conditions
      let name = formData.fee_type || ''
      const nameParts: string[] = []
      if (formData.ship_option_id) {
        nameParts.push(`Ship ${formData.ship_option_id}`)
      }
      if (formData.conditions?.weight_min_oz !== undefined) {
        const bracket = WEIGHT_BRACKETS.find(b => b.minOz === formData.conditions?.weight_min_oz)
        if (bracket) nameParts.push(bracket.label)
      }
      if (nameParts.length > 0) {
        name = `${name} (${nameParts.join(', ')})`
      }

      const dataToSave = {
        ...formData,
        name,
        priority: 0,
        is_additive: false,
      }

      await onSave(dataToSave)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule')
    } finally {
      setIsSaving(false)
    }
  }

  const isNew = !rule?.id
  const categoryConfig = formData.billing_category
    ? FEE_TYPE_CATEGORIES[formData.billing_category as keyof typeof FEE_TYPE_CATEGORIES]
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add Markup Rule' : 'Edit Markup Rule'}</DialogTitle>
          <DialogDescription>
            Configure how costs are marked up for client billing
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          {/* Client Selection */}
          <div className="space-y-1.5">
            <Label htmlFor="client" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Client
            </Label>
            <Select
              value={formData.client_id || 'global'}
              onValueChange={v =>
                setFormData({ ...formData, client_id: v === 'global' ? null : v })
              }
            >
              <SelectTrigger className={cn("h-9", (formData.client_id || 'global') ? "text-foreground" : "text-muted-foreground/40")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">All Clients (Global)</SelectItem>
                {clients.map(client => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.company_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Category and Fee Type */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="category">Billing Category *</Label>
              <Select
                value={formData.billing_category}
                onValueChange={v =>
                  setFormData({
                    ...formData,
                    billing_category: v,
                    fee_type: null,
                    ship_option_id: null,
                    conditions: null,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FEE_TYPE_CATEGORIES).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="feeType">Fee Type *</Label>
              <Select
                value={formData.fee_type || ''}
                onValueChange={v => setFormData({
                  ...formData,
                  fee_type: v,
                  // Reset ship option and weight when fee type changes
                  ship_option_id: null,
                  conditions: null,
                })}
                disabled={!categoryConfig}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select fee type" />
                </SelectTrigger>
                <SelectContent>
                  {categoryConfig?.types.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Ship Option & Weight Bracket - Only for Standard Shipments */}
          {formData.billing_category === 'shipments' && formData.fee_type === 'Standard' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="shipOptionId">Ship Option ID</Label>
                <Input
                  id="shipOptionId"
                  type="text"
                  placeholder="e.g., 146 (optional)"
                  value={formData.ship_option_id || ''}
                  onChange={e =>
                    setFormData({ ...formData, ship_option_id: e.target.value || null })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Specific carrier/service code. Leave empty for all.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="weightBracket">Weight Bracket</Label>
                <Select
                  value={
                    formData.conditions?.weight_min_oz !== undefined
                      ? `${formData.conditions.weight_min_oz}-${formData.conditions.weight_max_oz ?? '+'}`
                      : 'all'
                  }
                  onValueChange={v => {
                    if (v === 'all') {
                      setFormData({ ...formData, conditions: null })
                    } else {
                      const bracket = WEIGHT_BRACKETS.find(b => b.value === v)
                      if (bracket) {
                        setFormData({
                          ...formData,
                          conditions: {
                            ...formData.conditions,
                            weight_min_oz: bracket.minOz,
                            weight_max_oz: bracket.maxOz ?? undefined,
                          },
                        })
                      }
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All weights" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Weights</SelectItem>
                    {WEIGHT_BRACKETS.map(bracket => (
                      <SelectItem key={bracket.value} value={bracket.value}>
                        {bracket.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Applies markup only to shipments in this weight range.
                </p>
              </div>
            </div>
          )}

          {/* Markup Value */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="markupType">Markup Type *</Label>
              <Select
                value={formData.markup_type}
                onValueChange={v =>
                  setFormData({ ...formData, markup_type: v as 'percentage' | 'fixed' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage (%)</SelectItem>
                  <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="markupValue">
                {formData.markup_type === 'percentage' ? 'Percentage' : 'Amount'} *
              </Label>
              <div className="relative">
                {formData.markup_type === 'fixed' && (
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                )}
                <Input
                  id="markupValue"
                  type="number"
                  step={formData.markup_type === 'percentage' ? '0.1' : '0.01'}
                  value={formData.markup_value}
                  onChange={e =>
                    setFormData({ ...formData, markup_value: parseFloat(e.target.value) || 0 })
                  }
                  className={formData.markup_type === 'fixed' ? 'pl-8' : ''}
                  required
                />
                {formData.markup_type === 'percentage' && (
                  <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </div>

          {/* Effective Dates */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="effectiveFrom">Effective From *</Label>
              <Input
                id="effectiveFrom"
                type="date"
                value={formData.effective_from}
                onChange={e => setFormData({ ...formData, effective_from: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="effectiveTo">Effective To</Label>
              <Input
                id="effectiveTo"
                type="date"
                value={formData.effective_to || ''}
                onChange={e =>
                  setFormData({ ...formData, effective_to: e.target.value || null })
                }
              />
              <p className="text-xs text-muted-foreground">Leave empty for no end date</p>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description / Notes</Label>
            <Textarea
              id="description"
              value={formData.description || ''}
              onChange={e =>
                setFormData({ ...formData, description: e.target.value || null })
              }
              placeholder="Optional notes about this rule..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <JetpackLoader size="sm" className="mr-2" />}
              {isNew ? 'Create Rule' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// Invoicing Tab Content
// ============================================

interface PreflightValidationIssue {
  category: string
  severity: 'critical' | 'warning'
  message: string
  count: number
  percentage: number
}

interface PreflightClientResult {
  clientId: string
  clientName: string
  passed: boolean
  issues: PreflightValidationIssue[]
  warnings: PreflightValidationIssue[]
  summary: {
    shippingTransactions: number
    shippingCost: number
    additionalServiceTransactions: number
    additionalServiceCost: number
    storageTransactions: number
    storageCost: number
    returnsTransactions: number
    returnsCost: number
    receivingTransactions: number
    receivingCost: number
    creditsTransactions: number
    creditsCost: number
  }
}

interface UnattributedTransaction {
  transaction_id: string
  reference_id: string | null
  reference_type: string | null
  fee_type: string | null
  cost: number | null
  charge_date: string | null
  additional_details: Record<string, unknown> | null
}

interface PreflightResult {
  success: boolean
  shipbobInvoiceCount: number
  globalIssues?: PreflightValidationIssue[]  // Global issues (not per-client)
  unattributedTransactions?: UnattributedTransaction[]  // Full transaction details for display
  clients: PreflightClientResult[]
  summary: {
    totalClients: number
    passed: number
    warnings: number
    failed: number
    hasGlobalIssues?: boolean
  }
}

function InvoicingContent({ clients }: { clients: Client[] }) {
  const [invoices, setInvoices] = React.useState<JetpackInvoice[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Filter state
  const [clientFilter, setClientFilter] = React.useState<string>('all')
  const [dateFilter, setDateFilter] = React.useState<string>('all')

  // Pagination state
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)

  // Preflight validation state
  const [preflightResult, setPreflightResult] = React.useState<PreflightResult | null>(null)
  const [isLoadingPreflight, setIsLoadingPreflight] = React.useState(false)
  const [preflightExpanded, setPreflightExpanded] = React.useState(false)

  // Confirmation dialog state
  const [approveDialogOpen, setApproveDialogOpen] = React.useState(false)
  const [approveAllDialogOpen, setApproveAllDialogOpen] = React.useState(false)
  const [regenerateDialogOpen, setRegenerateDialogOpen] = React.useState(false)
  const [regenerateAllDialogOpen, setRegenerateAllDialogOpen] = React.useState(false)
  const [resendDialogOpen, setResendDialogOpen] = React.useState(false)
  const [selectedInvoiceId, setSelectedInvoiceId] = React.useState<string | null>(null)
  const [isRegenerating, setIsRegenerating] = React.useState<string | null>(null)
  const [isRegeneratingAll, setIsRegeneratingAll] = React.useState(false)
  const [isApproving, setIsApproving] = React.useState<string | null>(null)
  const [isResending, setIsResending] = React.useState<string | null>(null)

  // CC charge state
  const [chargeCcDialogOpen, setChargeCcDialogOpen] = React.useState(false)
  const [chargeCcInvoice, setChargeCcInvoice] = React.useState<JetpackInvoice | null>(null)
  const [isChargingCc, setIsChargingCc] = React.useState(false)
  const [ccChargePreview, setCcChargePreview] = React.useState<{
    baseAmount: number
    ccFeeToAdd: number
    totalToCharge: number
    hasCcFeeInInvoice: boolean
  } | null>(null)

  React.useEffect(() => {
    fetchInvoices()
    fetchPreflightValidation()
  }, [])

  // Filter approved invoices by client and date - must be before early returns
  const approvedInvoices = React.useMemo(() => {
    let filtered = invoices.filter(i => i.status === 'approved' || i.status === 'sent')

    // Client filter
    if (clientFilter !== 'all') {
      filtered = filtered.filter(i => i.client_id === clientFilter)
    }

    // Date filter
    if (dateFilter !== 'all') {
      const now = new Date()
      let cutoffDate: Date

      switch (dateFilter) {
        case '7d':
          cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          break
        case '30d':
          cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          break
        case '90d':
          cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
          break
        default:
          cutoffDate = new Date(0) // Beginning of time
      }

      filtered = filtered.filter(i => {
        const invoiceDate = new Date(i.invoice_date)
        return invoiceDate >= cutoffDate
      })
    }

    return filtered
  }, [invoices, clientFilter, dateFilter])

  // Paginated invoices - slice the filtered results
  const paginatedInvoices = React.useMemo(() => {
    const start = pageIndex * pageSize
    return approvedInvoices.slice(start, start + pageSize)
  }, [approvedInvoices, pageIndex, pageSize])

  // Total pages calculation
  const totalPages = Math.ceil(approvedInvoices.length / pageSize)

  // Reset page when filters change
  React.useEffect(() => {
    setPageIndex(0)
  }, [clientFilter, dateFilter])

  async function fetchInvoices() {
    setIsLoading(true)
    try {
      const response = await fetch('/api/admin/invoices')
      if (!response.ok) throw new Error('Failed to fetch invoices')
      const data = await response.json()
      setInvoices(data.invoices || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoices')
    } finally {
      setIsLoading(false)
    }
  }

  async function fetchPreflightValidation() {
    setIsLoadingPreflight(true)
    try {
      const response = await fetch('/api/admin/invoices/preflight')
      if (!response.ok) throw new Error('Failed to fetch preflight validation')
      const data = await response.json()
      setPreflightResult(data)
    } catch (err) {
      console.error('Error fetching preflight validation:', err)
    } finally {
      setIsLoadingPreflight(false)
    }
  }

  async function handleGenerateInvoices() {
    setIsGenerating(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/invoices/generate', { method: 'POST' })
      if (!response.ok) throw new Error('Failed to generate invoices')
      await fetchInvoices()
      await fetchPreflightValidation()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invoices')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleApproveInvoice(invoiceId: string) {
    setIsApproving(invoiceId)
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/approve`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to approve invoice')
      await fetchInvoices()
    } catch (err) {
      console.error('Error approving invoice:', err)
      setError(err instanceof Error ? err.message : 'Failed to approve invoice')
    } finally {
      setIsApproving(null)
      setApproveDialogOpen(false)
      setSelectedInvoiceId(null)
    }
  }

  async function handleApproveAll() {
    const draftInvoices = invoices.filter(i => i.status === 'draft')
    for (const invoice of draftInvoices) {
      await handleApproveInvoice(invoice.id)
    }
    setApproveAllDialogOpen(false)
  }

  async function handleTogglePaidStatus(invoiceId: string, currentPaidStatus: string) {
    const newPaid = currentPaidStatus !== 'paid'
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: newPaid }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update paid status')
      }
      // Update local state immediately for responsiveness
      setInvoices(prev => prev.map(inv =>
        inv.id === invoiceId
          ? { ...inv, paid_status: newPaid ? 'paid' : 'unpaid' }
          : inv
      ))
    } catch (err) {
      console.error('Error updating paid status:', err)
      setError(err instanceof Error ? err.message : 'Failed to update paid status')
    }
  }

  // Open CC charge dialog and fetch preview
  async function handleOpenChargeCcDialog(invoice: JetpackInvoice) {
    setChargeCcInvoice(invoice)
    setCcChargePreview(null)
    setChargeCcDialogOpen(true)

    try {
      const response = await fetch(`/api/admin/invoices/${invoice.id}/charge-cc`)
      if (response.ok) {
        const data = await response.json()
        setCcChargePreview({
          baseAmount: data.baseAmount,
          ccFeeToAdd: data.ccFeeToAdd,
          totalToCharge: data.totalToCharge,
          hasCcFeeInInvoice: data.hasCcFeeInInvoice,
        })
      }
    } catch (err) {
      console.error('Error fetching charge preview:', err)
    }
  }

  // Execute CC charge
  async function handleChargeCc() {
    if (!chargeCcInvoice) return

    setIsChargingCc(true)
    setError(null)

    try {
      const response = await fetch(`/api/admin/invoices/${chargeCcInvoice.id}/charge-cc`, {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to charge invoice')
      }

      if (data.success) {
        // Update local state
        setInvoices(prev => prev.map(inv =>
          inv.id === chargeCcInvoice.id
            ? {
                ...inv,
                paid_status: 'paid',
                total_amount: data.amountCharged,
              }
            : inv
        ))
        setChargeCcDialogOpen(false)
        setChargeCcInvoice(null)
        setCcChargePreview(null)
      } else {
        throw new Error(data.error || 'Payment failed')
      }
    } catch (err) {
      console.error('Error charging invoice:', err)
      setError(err instanceof Error ? err.message : 'Failed to charge invoice')
    } finally {
      setIsChargingCc(false)
    }
  }

  async function handleResendInvoice(invoiceId: string) {
    setIsResending(invoiceId)
    setError(null)
    setResendDialogOpen(false)

    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/resend`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to resend invoice email')
      }

      // Refresh invoices to show updated email_sent_at
      await fetchInvoices()
    } catch (err) {
      console.error('Error resending invoice:', err)
      setError(err instanceof Error ? err.message : 'Failed to resend invoice email')
    } finally {
      setIsResending(null)
    }
  }

  async function handleRegenerateAll() {
    setIsRegeneratingAll(true)
    setError(null)
    setRegenerateAllDialogOpen(false)

    const draftInvoices = invoices.filter(i => i.status === 'draft')
    let successCount = 0
    let failCount = 0

    for (const invoice of draftInvoices) {
      try {
        setIsRegenerating(invoice.id)
        const response = await fetch(`/api/admin/invoices/${invoice.id}/regenerate`, {
          method: 'POST',
        })
        if (response.ok) {
          successCount++
        } else {
          failCount++
        }
      } catch {
        failCount++
      }
    }

    // Final refresh after all regenerations
    setIsRegenerating(null)
    setIsRegeneratingAll(false)
    await fetchInvoices()
    await fetchPreflightValidation()

    if (failCount > 0) {
      setError(`Regenerated ${successCount} invoices, ${failCount} failed`)
    }
  }

  async function handleRegenerateInvoice(invoiceId: string) {
    setIsRegenerating(invoiceId)
    setError(null)

    // Get current invoice state to detect when it changes
    const currentInvoice = invoices.find(i => i.id === invoiceId)
    const initialVersion = currentInvoice?.version || 1
    const initialGeneratedAt = currentInvoice?.generated_at

    try {
      // Start regeneration (fire and forget - we'll poll for completion)
      const regeneratePromise = fetch(`/api/admin/invoices/${invoiceId}/regenerate`, {
        method: 'POST',
      }).then(async (response) => {
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Failed to regenerate invoice')
        }
        return data
      })

      // Poll for completion every 2 seconds (detect the moment it's done)
      const maxAttempts = 150 // 5 minutes max (150 * 2s)
      let attempts = 0
      let completed = false

      const pollForCompletion = async () => {
        while (!completed && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000))
          attempts++

          try {
            const checkResponse = await fetch('/api/admin/invoices')
            if (checkResponse.ok) {
              const checkData = await checkResponse.json()
              const updatedInvoice = checkData.invoices?.find((i: JetpackInvoice) => i.id === invoiceId)

              if (updatedInvoice) {
                const versionIncreased = updatedInvoice.version > initialVersion
                const generatedAtChanged = updatedInvoice.generated_at !== initialGeneratedAt

                if (versionIncreased || generatedAtChanged) {
                  completed = true
                  // Clear spinner IMMEDIATELY when completion is detected
                  setIsRegenerating(null)
                  setRegenerateDialogOpen(false)
                  setSelectedInvoiceId(null)
                  setInvoices(checkData.invoices)
                  // Do validation refresh async (don't block UI)
                  fetchPreflightValidation()
                  return true
                }
              }
            }
          } catch {
            // Ignore polling errors, continue polling
          }
        }
        return false
      }

      // Race: either polling detects completion OR the request finishes
      const result = await Promise.race([
        pollForCompletion(),
        regeneratePromise.then(() => 'request_done' as const)
      ])

      // If request finished first, do a final refresh
      if (result === 'request_done' && !completed) {
        // Clear spinner immediately when request completes
        setIsRegenerating(null)
        setRegenerateDialogOpen(false)
        setSelectedInvoiceId(null)
        await fetchInvoices()
        // Do validation refresh async
        fetchPreflightValidation()
      }
    } catch (err) {
      console.error('Error regenerating invoice:', err)
      setError(err instanceof Error ? err.message : 'Failed to regenerate invoice')
      // Clear spinner on error too
      setIsRegenerating(null)
      setRegenerateDialogOpen(false)
      setSelectedInvoiceId(null)
    }
  }

  async function handleViewFile(invoiceId: string, fileType: 'pdf' | 'xlsx') {
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/files`)
      if (!response.ok) throw new Error('Failed to get file URL')
      const data = await response.json()

      const url = fileType === 'pdf' ? data.pdfUrl : data.xlsUrl
      if (!url) {
        throw new Error(`${fileType.toUpperCase()} file not available`)
      }

      // Open in new tab for viewing
      window.open(url, '_blank')
    } catch (err) {
      console.error('Error viewing file:', err)
      setError(err instanceof Error ? err.message : 'Failed to view file')
    }
  }

  async function handleForceDownloadFile(invoiceId: string, fileType: 'pdf' | 'xlsx', invoiceNumber: string) {
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/files`)
      if (!response.ok) throw new Error('Failed to get file URL')
      const data = await response.json()

      const url = fileType === 'pdf' ? data.pdfUrl : data.xlsUrl
      if (!url) {
        throw new Error(`${fileType.toUpperCase()} file not available`)
      }

      // Fetch the file as blob and force download
      const fileResponse = await fetch(url)
      if (!fileResponse.ok) throw new Error('Failed to fetch file')
      const blob = await fileResponse.blob()

      // Create download link
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = fileType === 'pdf' ? `${invoiceNumber}.pdf` : `${invoiceNumber}-details.xlsx`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)
    } catch (err) {
      console.error('Error downloading file:', err)
      setError(err instanceof Error ? err.message : 'Failed to download file')
    }
  }

  if (isLoading) return null

  const draftInvoices = invoices.filter(i => i.status === 'draft')

  // Calculate preflight summary
  const hasPreflightIssues = preflightResult && (
    preflightResult.summary.failed > 0 || preflightResult.summary.warnings > 0
  )

  return (
    <TooltipProvider>
      <>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Invoice Management</h2>
            <p className="text-sm text-muted-foreground">
              Generate, review, and approve weekly client invoices
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { fetchInvoices(); fetchPreflightValidation() }} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={handleGenerateInvoices} disabled={isGenerating} className="gap-2">
              {isGenerating ? (
                <JetpackLoader size="sm" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Generate Invoices
            </Button>
          </div>
        </div>

        {error && (
          <Card>
            <CardContent className="py-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <p>{error}</p>
                <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-auto">
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pre-flight Validation Card */}
        <Card className={cn(
          preflightResult?.summary.failed && preflightResult.summary.failed > 0 && "border-destructive",
          preflightResult?.summary.warnings && preflightResult.summary.warnings > 0 && preflightResult.summary.failed === 0 && "border-yellow-500"
        )}>
          <Collapsible open={preflightExpanded} onOpenChange={setPreflightExpanded}>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {preflightExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        Pre-flight Validation
                        {isLoadingPreflight && <JetpackLoader size="sm" />}
                      </CardTitle>
                      <CardDescription>
                        Data quality checks before invoice generation
                      </CardDescription>
                    </div>
                  </div>
                  {preflightResult && (
                    <div className="flex items-center gap-2">
                      {preflightResult.summary.failed > 0 && (
                        <Badge variant="destructive" className="gap-1">
                          <XCircle className="h-3 w-3" />
                          {preflightResult.summary.failed} Failed
                        </Badge>
                      )}
                      {preflightResult.summary.warnings > 0 && (
                        <Badge variant="outline" className="gap-1 border-yellow-500 text-yellow-600">
                          <AlertTriangle className="h-3 w-3" />
                          {preflightResult.summary.warnings} Warnings
                        </Badge>
                      )}
                      {preflightResult.summary.passed > 0 && (
                        <Badge variant="outline" className="gap-1 border-green-500 text-green-600">
                          <CheckCircle2 className="h-3 w-3" />
                          {preflightResult.summary.passed} Passed
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {!preflightResult ? (
                  <p className="text-center text-muted-foreground py-4">
                    No validation data available
                  </p>
                ) : preflightResult.clients.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    No unprocessed ShipBob invoices found
                  </p>
                ) : (
                  <div className="space-y-4">
                    {/* Aggregate Totals Summary Box */}
                    {(() => {
                      // Calculate totals across all clients
                      const totals = preflightResult.clients.reduce((acc, client) => ({
                        shipping: acc.shipping + client.summary.shippingCost,
                        shippingCount: acc.shippingCount + client.summary.shippingTransactions,
                        additionalService: acc.additionalService + client.summary.additionalServiceCost,
                        additionalServiceCount: acc.additionalServiceCount + client.summary.additionalServiceTransactions,
                        storage: acc.storage + client.summary.storageCost,
                        storageCount: acc.storageCount + client.summary.storageTransactions,
                        returns: acc.returns + client.summary.returnsCost,
                        returnsCount: acc.returnsCount + client.summary.returnsTransactions,
                        receiving: acc.receiving + client.summary.receivingCost,
                        receivingCount: acc.receivingCount + client.summary.receivingTransactions,
                        credits: acc.credits + client.summary.creditsCost,
                        creditsCount: acc.creditsCount + client.summary.creditsTransactions,
                      }), {
                        shipping: 0, shippingCount: 0,
                        additionalService: 0, additionalServiceCount: 0,
                        storage: 0, storageCount: 0,
                        returns: 0, returnsCount: 0,
                        receiving: 0, receivingCount: 0,
                        credits: 0, creditsCount: 0,
                      })

                      // Credits are stored as negative numbers in DB, so we ADD them (not subtract)
                      const grandTotal = totals.shipping + totals.additionalService + totals.storage + totals.returns + totals.receiving + totals.credits

                      const formatCurrency = (val: number) => val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

                      // Build items array for clean rendering
                      const items = [
                        totals.shippingCount > 0 && { label: 'Shipping', value: totals.shipping, count: totals.shippingCount },
                        totals.additionalServiceCount > 0 && { label: 'Addl Services', value: totals.additionalService, count: totals.additionalServiceCount },
                        totals.storageCount > 0 && { label: 'Storage', value: totals.storage, count: totals.storageCount },
                        totals.returnsCount > 0 && { label: 'Returns', value: totals.returns, count: totals.returnsCount },
                        totals.receivingCount > 0 && { label: 'Receiving', value: totals.receiving, count: totals.receivingCount },
                        totals.creditsCount > 0 && { label: 'Credits', value: -totals.credits, count: totals.creditsCount, isCredit: true },
                      ].filter(Boolean) as { label: string; value: number; count: number; isCredit?: boolean }[]

                      const totalTransactions = items.reduce((sum, item) => sum + item.count, 0)

                      return (
                        <div className="relative mb-2">
                          {/* Grand Total tab */}
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 rounded-t-md">
                            <span>Grand Total</span>
                          </div>

                          {/* Main gradient card */}
                          <div className="rounded-lg rounded-tl-none border bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
                            <div className="flex items-center justify-between">
                              {/* Left: Category pills */}
                              <div className="flex flex-wrap gap-1.5">
                                {items.map((item, idx) => (
                                  <div
                                    key={idx}
                                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-white/80 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300 shadow-sm"
                                  >
                                    <span>{item.label}</span>
                                    <span className="text-muted-foreground tabular-nums">{item.count.toLocaleString()}</span>
                                    <span className={cn("tabular-nums font-semibold", (item.value < 0 || item.isCredit) && "text-red-600 dark:text-red-400")}>
                                      {item.value < 0 || item.isCredit ? '-' : ''}${formatCurrency(Math.abs(item.value))}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              {/* Right: Grand total */}
                              <div className="text-right pl-4 flex-shrink-0">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                                  {totalTransactions.toLocaleString()} transactions
                                </div>
                                <div className="text-xl font-bold tabular-nums tracking-tight">
                                  ${formatCurrency(grandTotal)}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    {preflightResult.clients.map(client => {
                      // Build array of visible items
                      const items: { label: string; count: number; cost: number; isCredit?: boolean }[] = []
                      if (client.summary.shippingTransactions > 0) items.push({ label: 'Shipping', count: client.summary.shippingTransactions, cost: client.summary.shippingCost })
                      if (client.summary.additionalServiceTransactions > 0) items.push({ label: 'Addl Svc', count: client.summary.additionalServiceTransactions, cost: client.summary.additionalServiceCost })
                      if (client.summary.storageTransactions > 0) items.push({ label: 'Storage', count: client.summary.storageTransactions, cost: client.summary.storageCost })
                      if (client.summary.returnsTransactions > 0) items.push({ label: 'Returns', count: client.summary.returnsTransactions, cost: client.summary.returnsCost })
                      if (client.summary.receivingTransactions > 0) items.push({ label: 'Receiving', count: client.summary.receivingTransactions, cost: client.summary.receivingCost })
                      if (client.summary.creditsTransactions > 0) items.push({ label: 'Credits', count: client.summary.creditsTransactions, cost: client.summary.creditsCost, isCredit: true })

                      // Calculate client totals
                      const totalTransactions = items.reduce((sum, item) => sum + item.count, 0)
                      const totalCost = items.reduce((sum, item) => sum + item.cost, 0)

                      return (
                        <div key={client.clientId} className="relative">
                          {/* Client name tab */}
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-slate-200 dark:bg-slate-700 rounded-t-md">
                            {client.passed ? (
                              client.warnings.length > 0 ? (
                                <AlertTriangle className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-500" />
                              )
                            ) : (
                              <XCircle className="h-3 w-3 text-destructive" />
                            )}
                            <span>{client.clientName}</span>
                          </div>

                          {/* Main gradient card */}
                          <div className="rounded-lg rounded-tl-none border bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
                            {/* Category pills and totals */}
                            {items.length > 0 && (
                              <div className="flex items-center justify-between gap-4">
                                {/* Left: Category pills */}
                                <div className="flex flex-wrap gap-1.5">
                                  {items.map((item, idx) => (
                                    <div
                                      key={idx}
                                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-white/80 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300 shadow-sm"
                                    >
                                      <span>{item.label}</span>
                                      <span className="text-muted-foreground tabular-nums">{item.count.toLocaleString()}</span>
                                      <span className={cn("tabular-nums font-semibold", (item.cost < 0 || item.isCredit) && "text-red-600 dark:text-red-400")}>
                                        {item.cost < 0 || item.isCredit ? '-' : ''}${Math.abs(item.cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                {/* Right: Client total */}
                                <div className="text-right pl-3 flex-shrink-0">
                                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                                    {totalTransactions.toLocaleString()} transactions
                                  </div>
                                  <div className={cn("text-xl font-bold tabular-nums tracking-tight", totalCost < 0 && "text-red-600 dark:text-red-400")}>
                                    {totalCost < 0 ? '-' : ''}${Math.abs(totalCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Issues and warnings below pills */}
                            {(client.issues.length > 0 || client.warnings.length > 0) && (
                              <div className={cn("space-y-1", items.length > 0 && "mt-3 pt-3 border-t border-slate-200 dark:border-slate-700")}>
                                {client.issues.map((issue, idx) => (
                                  <div key={`issue-${idx}`} className="text-sm text-destructive flex items-start gap-2">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                    <span>{issue.message}</span>
                                  </div>
                                ))}
                                {client.warnings.map((warning, idx) => (
                                  <div key={`warning-${idx}`} className="text-sm text-yellow-600 dark:text-yellow-500 flex items-start gap-2">
                                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                    <span>{warning.message}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Unattributed Transactions Table */}
                    {preflightResult.unattributedTransactions && preflightResult.unattributedTransactions.length > 0 && (
                      <div className="border border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-4 mt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                          <span className="font-medium text-yellow-800 dark:text-yellow-200">
                            Unattributed Transactions ({preflightResult.unattributedTransactions.length})
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-muted-foreground border-b">
                                <th className="pb-2 pr-4">Fee Type</th>
                                <th className="pb-2 pr-4">Reference</th>
                                <th className="pb-2 pr-4">Type</th>
                                <th className="pb-2 pr-4 text-right">Cost</th>
                                <th className="pb-2 pr-4">Date</th>
                                <th className="pb-2">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {preflightResult.unattributedTransactions.map((tx) => (
                                  <tr key={tx.transaction_id} className="text-sm">
                                    <td className="py-2 pr-4">{tx.fee_type || '-'}</td>
                                    <td className="py-2 pr-4 font-mono text-xs">{tx.reference_id || '-'}</td>
                                    <td className="py-2 pr-4">{tx.reference_type || '-'}</td>
                                    <td className="py-2 pr-4 text-right tabular-nums">
                                      ${(tx.cost || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="py-2 pr-4">
                                      {tx.charge_date ? new Date(tx.charge_date).toLocaleDateString() : '-'}
                                    </td>
                                    <td className="py-2">
                                      <div className="flex items-center gap-1">
                                        <Select
                                          onValueChange={async (clientId) => {
                                            try {
                                              const res = await fetch(`/api/admin/transactions/${tx.transaction_id}/link`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ clientId })
                                              })
                                              if (res.ok) {
                                                // Refresh preflight after linking
                                                const newPreflight = await fetch('/api/admin/invoices/preflight')
                                                if (newPreflight.ok) {
                                                  setPreflightResult(await newPreflight.json())
                                                }
                                              }
                                            } catch (err) {
                                              console.error('Failed to link transaction:', err)
                                            }
                                          }}
                                        >
                                          <SelectTrigger className="h-7 w-[130px] text-xs">
                                            <SelectValue placeholder="Link to..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="__jetpack_parent__" className="text-xs font-medium text-blue-600">
                                              Jetpack (Parent)
                                            </SelectItem>
                                            <div className="h-px bg-border my-1" />
                                            {clients.map(c => (
                                              <SelectItem key={c.id} value={c.id} className="text-xs">
                                                {c.company_name}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2 text-xs"
                                          onClick={async () => {
                                            try {
                                              const res = await fetch(`/api/admin/transactions/${tx.transaction_id}/dispute`, {
                                                method: 'POST'
                                              })
                                              if (res.ok) {
                                                const newPreflight = await fetch('/api/admin/invoices/preflight')
                                                if (newPreflight.ok) {
                                                  setPreflightResult(await newPreflight.json())
                                                }
                                              }
                                            } catch (err) {
                                              console.error('Failed to dispute transaction:', err)
                                            }
                                          }}
                                        >
                                          Dispute
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2 text-xs text-muted-foreground"
                                          onClick={async () => {
                                            try {
                                              const res = await fetch(`/api/admin/transactions/${tx.transaction_id}/ignore`, {
                                                method: 'POST'
                                              })
                                              if (res.ok) {
                                                const newPreflight = await fetch('/api/admin/invoices/preflight')
                                                if (newPreflight.ok) {
                                                  setPreflightResult(await newPreflight.json())
                                                }
                                              }
                                            } catch (err) {
                                              console.error('Failed to ignore transaction:', err)
                                            }
                                          }}
                                        >
                                          Ignore
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {preflightResult.unattributedTransactions.some(tx => tx.additional_details?.Comment) && (
                          <div className="mt-3 pt-3 border-t border-yellow-200 dark:border-yellow-800">
                            <div className="text-xs text-yellow-700 dark:text-yellow-300 font-medium mb-1">Transaction Comments:</div>
                            {preflightResult.unattributedTransactions.filter(tx => tx.additional_details?.Comment).map(tx => (
                              <div key={tx.transaction_id} className="text-xs text-yellow-600 dark:text-yellow-400">
                                <span className="font-mono">{tx.reference_id}</span>: {String(tx.additional_details?.Comment)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {/* Draft Invoices - Pending Approval */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Pending Approval</CardTitle>
                <CardDescription>
                  Review and approve invoices before sending to clients
                </CardDescription>
              </div>
              {draftInvoices.length > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setRegenerateAllDialogOpen(true)}
                    className="gap-2"
                    disabled={isRegeneratingAll}
                  >
                    {isRegeneratingAll ? (
                      <JetpackLoader size="sm" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    Re-generate All
                  </Button>
                  <Button onClick={() => setApproveAllDialogOpen(true)} className="gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Approve All ({draftInvoices.length})
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {draftInvoices.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No pending invoices. Generate new invoices to get started.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Our Cost</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[180px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draftInvoices.map(invoice => {
                    const client = clients.find(c => c.id === invoice.client_id)
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">
                          {invoice.invoice_number}
                          {invoice.version > 1 && (
                            <Badge variant="outline" className="ml-2 text-xs">v{invoice.version}</Badge>
                          )}
                        </TableCell>
                        <TableCell>{client?.company_name || 'Unknown'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateFixed(invoice.period_start)} -{' '}
                          {formatDateFixed(invoice.period_end)}
                        </TableCell>
                        <TableCell className="text-right">
                          ${invoice.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right text-green-600">
                          +${invoice.total_markup.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ${invoice.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">Draft</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {/* View/Download Dropdown */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleViewFile(invoice.id, 'pdf')}>
                                  <FileText className="h-4 w-4 mr-2" />
                                  View PDF
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleViewFile(invoice.id, 'xlsx')}>
                                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                                  View XLSX
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>

                            {/* Re-Run Button */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={isRegenerating === invoice.id}
                                  onClick={() => {
                                    setSelectedInvoiceId(invoice.id)
                                    setRegenerateDialogOpen(true)
                                  }}
                                >
                                  {isRegenerating === invoice.id ? (
                                    <JetpackLoader size="sm" />
                                  ) : (
                                    <RotateCcw className="h-4 w-4 text-blue-600" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Re-generate invoice</TooltipContent>
                            </Tooltip>

                            {/* Approve Button */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={isApproving === invoice.id}
                                  onClick={() => {
                                    setSelectedInvoiceId(invoice.id)
                                    setApproveDialogOpen(true)
                                  }}
                                >
                                  {isApproving === invoice.id ? (
                                    <JetpackLoader size="sm" />
                                  ) : (
                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Approve invoice</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {/* Totals Row */}
                  {draftInvoices.length > 1 && (
                    <TableRow className="bg-muted/50 font-semibold border-t-2">
                      <TableCell colSpan={3} className="text-right">
                        Total ({draftInvoices.length} invoices)
                      </TableCell>
                      <TableCell className="text-right">
                        ${draftInvoices.reduce((sum, inv) => sum + inv.subtotal, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        +${draftInvoices.reduce((sum, inv) => sum + inv.total_markup, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        ${draftInvoices.reduce((sum, inv) => sum + inv.total_amount, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell colSpan={2}></TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Approved Invoices */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Invoices</CardTitle>
                <CardDescription>Previously approved and sent invoices</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Brands" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Brands</SelectItem>
                    {clients.map(client => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.company_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="All Time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Time</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                    <SelectItem value="90d">Last 3 months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {approvedInvoices.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {clientFilter !== 'all' || dateFilter !== 'all'
                  ? 'No invoices match the selected filters.'
                  : 'No approved invoices yet.'}
              </p>
            ) : (
              <>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Invoice #</TableHead>
                    <TableHead className="w-[140px] text-center">Client</TableHead>
                    <TableHead className="w-[100px] text-center">Date</TableHead>
                    <TableHead className="w-[100px] text-center">Total</TableHead>
                    <TableHead className="w-[90px] text-center">Status</TableHead>
                    <TableHead className="w-[90px] text-center">Paid</TableHead>
                    <TableHead className="w-[90px] text-center">Email</TableHead>
                    <TableHead className="w-[60px] text-center">View</TableHead>
                    <TableHead className="w-[60px] text-center">Download</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedInvoices.map(invoice => {
                    const client = clients.find(c => c.id === invoice.client_id)
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">
                          {invoice.invoice_number}
                          {invoice.version > 1 && (
                            <Badge variant="outline" className="ml-2 text-xs">v{invoice.version}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">{client?.company_name || 'Unknown'}</TableCell>
                        <TableCell className="text-center">
                          {formatDateFixed(invoice.invoice_date)}
                        </TableCell>
                        <TableCell className="text-center font-semibold">
                          ${invoice.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={invoice.status === 'sent' ? 'default' : 'secondary'}
                          >
                            {invoice.status === 'sent' ? 'Sent' : 'Approved'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Badge
                                variant={invoice.paid_status === 'paid' ? 'default' : 'outline'}
                                className={cn(
                                  'cursor-pointer transition-colors',
                                  invoice.paid_status === 'paid'
                                    ? 'bg-green-600 hover:bg-green-700'
                                    : 'hover:bg-muted'
                                )}
                              >
                                {invoice.paid_status === 'paid' ? 'Paid' : 'Unpaid'}
                              </Badge>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="center">
                              <DropdownMenuItem
                                onClick={() => handleTogglePaidStatus(invoice.id, 'unpaid')}
                                disabled={invoice.paid_status === 'paid'}
                              >
                                <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
                                Mark as Paid
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleTogglePaidStatus(invoice.id, 'paid')}
                                disabled={invoice.paid_status === 'unpaid'}
                              >
                                <XCircle className="h-4 w-4 mr-2 text-muted-foreground" />
                                Mark as Unpaid
                              </DropdownMenuItem>
                              {/* Pay Via CC - only show if client has CC configured and invoice is unpaid */}
                              {invoice.paid_status === 'unpaid' &&
                               invoice.client?.stripe_customer_id &&
                               invoice.client?.stripe_payment_method_id && (
                                <DropdownMenuItem
                                  onClick={() => handleOpenChargeCcDialog(invoice)}
                                >
                                  <CreditCard className="h-4 w-4 mr-2 text-blue-600" />
                                  Pay Via CC
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className={`flex items-center justify-center ${invoice.email_sent_at || invoice.email_error ? '-space-x-2' : ''}`}>
                            {invoice.email_sent_at ? (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge variant="outline" className="text-emerald-600 border-emerald-600">
                                    <Mail className="mr-1 h-3 w-3" />
                                    Sent
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Sent {new Date(invoice.email_sent_at).toLocaleString()}</p>
                                </TooltipContent>
                              </Tooltip>
                            ) : invoice.email_error ? (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge variant="outline" className="text-red-600 border-red-600">
                                    <AlertCircle className="mr-1 h-3 w-3" />
                                    Failed
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-sm">{invoice.email_error}</p>
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="text-blue-600 border-blue-600 cursor-pointer hover:bg-blue-50 transition-colors"
                                  onClick={() => {
                                    setSelectedInvoiceId(invoice.id)
                                    setResendDialogOpen(true)
                                  }}
                                >
                                  {isResending === invoice.id ? (
                                    <JetpackLoader size="sm" />
                                  ) : (
                                    <Send className="h-3 w-3" />
                                  )}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Resend invoice email</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleViewFile(invoice.id, 'pdf')}>
                                <FileText className="h-4 w-4 mr-2" />
                                View PDF
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleViewFile(invoice.id, 'xlsx')}>
                                <FileSpreadsheet className="h-4 w-4 mr-2" />
                                View XLSX
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell className="text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <Download className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleForceDownloadFile(invoice.id, 'pdf', invoice.invoice_number)}>
                                <FileText className="h-4 w-4 mr-2" />
                                Download PDF
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleForceDownloadFile(invoice.id, 'xlsx', invoice.invoice_number)}>
                                <FileSpreadsheet className="h-4 w-4 mr-2" />
                                Download XLSX
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleResendInvoice(invoice.id)}
                                disabled={isResending === invoice.id}
                              >
                                <Mail className="h-4 w-4 mr-2" />
                                {isResending === invoice.id ? 'Sending...' : 'Resend Invoice'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {/* Pagination Footer */}
              <div className="flex items-center justify-between px-2 py-4 border-t">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground">
                    {paginatedInvoices.length.toLocaleString()} of {approvedInvoices.length.toLocaleString()} invoices
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Rows</span>
                    <Select
                      value={pageSize.toString()}
                      onValueChange={(value) => {
                        setPageSize(Number(value))
                        setPageIndex(0)
                      }}
                    >
                      <SelectTrigger className="h-7 w-[70px]">
                        <SelectValue placeholder={pageSize} />
                      </SelectTrigger>
                      <SelectContent>
                        {[25, 50, 100, 200].map((size) => (
                          <SelectItem key={size} value={size.toString()}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Page {pageIndex + 1} of {totalPages || 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setPageIndex(0)}
                      disabled={pageIndex === 0}
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
                      disabled={pageIndex === 0}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setPageIndex(Math.min(totalPages - 1, pageIndex + 1))}
                      disabled={pageIndex >= totalPages - 1}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setPageIndex(totalPages - 1)}
                      disabled={pageIndex >= totalPages - 1}
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Approve Single Invoice Confirmation Dialog */}
        <AlertDialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Approve Invoice?</AlertDialogTitle>
              <AlertDialogDescription>
                This will finalize the invoice and mark it as approved. Once approved, invoices cannot be modified. Are you sure you want to continue?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setSelectedInvoiceId(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => selectedInvoiceId && handleApproveInvoice(selectedInvoiceId)}
                className="bg-green-600 hover:bg-green-700"
              >
                Yes, Approve Invoice
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Approve All Invoices Confirmation Dialog */}
        <AlertDialog open={approveAllDialogOpen} onOpenChange={setApproveAllDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Approve All Invoices?</AlertDialogTitle>
              <AlertDialogDescription>
                This will approve {draftInvoices.length} draft invoice(s) and mark them as finalized. Once approved, invoices cannot be modified. Are you sure you want to continue?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleApproveAll}
                className="bg-green-600 hover:bg-green-700"
              >
                Yes, Approve All
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Re-generate All Invoices Confirmation Dialog */}
        <AlertDialog open={regenerateAllDialogOpen} onOpenChange={setRegenerateAllDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Re-generate All Invoices?</AlertDialogTitle>
              <AlertDialogDescription>
                This will regenerate all {draftInvoices.length} draft invoice(s) with fresh data, recalculate markups, and create new PDF/XLSX files. Version numbers will be incremented. Use this after making sync corrections or markup rule changes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRegenerateAll}>
                Yes, Re-generate All
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Regenerate Invoice Confirmation Dialog */}
        <AlertDialog open={regenerateDialogOpen} onOpenChange={setRegenerateDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Regenerate Invoice?</AlertDialogTitle>
              <AlertDialogDescription>
                This will regenerate the invoice with fresh data, recalculate markups, and create new PDF/XLSX files. The version number will be incremented. Use this after making sync corrections or markup rule changes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setSelectedInvoiceId(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => selectedInvoiceId && handleRegenerateInvoice(selectedInvoiceId)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Yes, Regenerate Invoice
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Resend Invoice Confirmation Dialog */}
        <AlertDialog open={resendDialogOpen} onOpenChange={setResendDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Resend Invoice Email?</AlertDialogTitle>
              <AlertDialogDescription>
                This will resend the invoice email to the client with the same PDF and XLSX attachments. The email_sent_at timestamp will be updated to the current time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setSelectedInvoiceId(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => selectedInvoiceId && handleResendInvoice(selectedInvoiceId)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Yes, Resend Email
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* CC Charge Confirmation Dialog */}
        <AlertDialog open={chargeCcDialogOpen} onOpenChange={setChargeCcDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Charge Credit Card
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    Charge invoice <strong>{chargeCcInvoice?.invoice_number}</strong> for{' '}
                    <strong>{chargeCcInvoice?.client?.company_name}</strong>?
                  </p>
                  {ccChargePreview ? (
                    <div className="bg-muted p-3 rounded-md space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Invoice Amount:</span>
                        <span>${ccChargePreview.baseAmount.toFixed(2)}</span>
                      </div>
                      {ccChargePreview.ccFeeToAdd > 0 && (
                        <div className="flex justify-between text-amber-600">
                          <span>+ CC Processing Fee (3%):</span>
                          <span>${ccChargePreview.ccFeeToAdd.toFixed(2)}</span>
                        </div>
                      )}
                      {ccChargePreview.hasCcFeeInInvoice && (
                        <div className="flex justify-between text-muted-foreground">
                          <span className="text-xs">(CC fee already included in invoice)</span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold border-t pt-2">
                        <span>Total to Charge:</span>
                        <span>${ccChargePreview.totalToCharge.toFixed(2)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-muted p-3 rounded-md text-sm text-muted-foreground">
                      Loading charge details...
                    </div>
                  )}
                  {ccChargePreview?.ccFeeToAdd && ccChargePreview.ccFeeToAdd > 0 && (
                    <p className="text-xs text-amber-600">
                      Note: The invoice did not include a CC fee, so 3% will be added to the charge amount.
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setChargeCcInvoice(null)
                  setCcChargePreview(null)
                }}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleChargeCc}
                disabled={isChargingCc || !ccChargePreview}
                className="bg-green-600 hover:bg-green-700"
              >
                {isChargingCc ? 'Charging...' : `Charge $${ccChargePreview?.totalToCharge.toFixed(2) || '...'}`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    </TooltipProvider>
  )
}

// ============================================
// Markup History Dialog
// ============================================

function MarkupHistoryDialog({
  open,
  onOpenChange,
  rule,
  history,
  isLoading,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule: MarkupRule | null
  history: RuleHistoryEntry[]
  isLoading: boolean
}) {
  function getChangeTypeBadge(changeType: string) {
    switch (changeType) {
      case 'created':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Created</Badge>
      case 'updated':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Updated</Badge>
      case 'deactivated':
        return <Badge className="bg-red-100 text-red-800 border-red-200">Deactivated</Badge>
      default:
        return <Badge variant="secondary">{changeType}</Badge>
    }
  }

  function formatFieldName(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
  }

  function formatFieldValue(value: unknown): string {
    if (value === null || value === undefined) return '—'
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  function getChangedFields(entry: RuleHistoryEntry): { field: string; from: unknown; to: unknown }[] {
    if (!entry.previous_values || !entry.new_values) return []

    const changes: { field: string; from: unknown; to: unknown }[] = []
    const allKeys = new Set([
      ...Object.keys(entry.previous_values || {}),
      ...Object.keys(entry.new_values || {}),
    ])

    // Fields to ignore in the diff
    const ignoreFields = ['id', 'created_at', 'updated_at']

    for (const key of allKeys) {
      if (ignoreFields.includes(key)) continue
      const prev = entry.previous_values?.[key]
      const next = entry.new_values?.[key]
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        changes.push({ field: key, from: prev, to: next })
      }
    }

    return changes
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Change History
          </DialogTitle>
          <DialogDescription>
            {rule?.fee_type || 'Unknown Rule'} - View all changes made to this markup rule
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <JetpackLoader size="lg" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No history recorded for this rule.</p>
            <p className="text-sm">Changes will appear here after edits are made.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {history.map((entry, index) => {
              const changes = getChangedFields(entry)
              return (
                <Card key={entry.id} className={cn(
                  "relative",
                  index < history.length - 1 && "after:absolute after:left-6 after:top-full after:h-4 after:w-px after:bg-border"
                )}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getChangeTypeBadge(entry.change_type)}
                        <span className="text-sm text-muted-foreground">
                          {new Date(entry.changed_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {entry.change_reason && (
                      <p className="text-sm text-muted-foreground mb-3 italic">
                        Reason: {entry.change_reason}
                      </p>
                    )}

                    {entry.change_type === 'created' && entry.new_values && (
                      <div className="text-sm">
                        <p className="font-medium mb-2">Initial values:</p>
                        <div className="grid gap-1 text-muted-foreground">
                          {Object.entries(entry.new_values)
                            .filter(([key]) => !['id', 'created_at', 'updated_at'].includes(key))
                            .filter(([, value]) => value !== null)
                            .map(([key, value]) => (
                              <div key={key} className="flex gap-2">
                                <span className="font-medium">{formatFieldName(key)}:</span>
                                <span>{formatFieldValue(value)}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {entry.change_type === 'updated' && changes.length > 0 && (
                      <div className="text-sm">
                        <p className="font-medium mb-2">Changes:</p>
                        <div className="space-y-2">
                          {changes.map(({ field, from, to }) => (
                            <div key={field} className="flex items-start gap-2 p-2 bg-muted/50 rounded">
                              <span className="font-medium min-w-[120px]">{formatFieldName(field)}:</span>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="line-through text-red-600 dark:text-red-400">
                                  {formatFieldValue(from)}
                                </span>
                                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                <span className="text-green-600 dark:text-green-400">
                                  {formatFieldValue(to)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {entry.change_type === 'deactivated' && (
                      <p className="text-sm text-red-600 dark:text-red-400">
                        Rule was deactivated
                      </p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// Sync Health Tab Content
// ============================================

interface HealthMetric {
  label: string
  description: string
  value: number
  total: number
  percentage: number
  status: 'good' | 'warning' | 'critical'
}

interface SyncHealthData {
  metrics: HealthMetric[]
  clientHealth: Array<{
    clientId: string
    clientName: string
    shipmentsWithTimeline: number
    totalDeliveredShipments: number
    timelinePercentage: number
  }>
  recentActivity: {
    ordersLast24h: number
    shipmentsLast24h: number
    transactionsLast24h: number
  }
  generatedAt: string
}

// ============================================
// Disputes Tab Content
// ============================================

interface DisputedTransaction {
  transaction_id: string
  client_id: string | null
  reference_id: string
  reference_type: string
  fee_type: string
  cost: number
  charge_date: string
  invoice_id_sb: number | null
  additional_details: Record<string, unknown> | null
  dispute_status: string | null
  dispute_reason: string | null
  dispute_created_at: string | null
  matched_credit_id: string | null
  clients?: { company_name: string }
}

function DisputesContent() {
  const [disputes, setDisputes] = React.useState<DisputedTransaction[]>([])
  const [unmatchedCredits, setUnmatchedCredits] = React.useState<DisputedTransaction[]>([])
  const [searchResults, setSearchResults] = React.useState<DisputedTransaction[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSearching, setIsSearching] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [statusFilter, setStatusFilter] = React.useState<string>('pending')
  const [selectedTransaction, setSelectedTransaction] = React.useState<DisputedTransaction | null>(null)
  const [isDisputeDialogOpen, setIsDisputeDialogOpen] = React.useState(false)
  const [disputeReason, setDisputeReason] = React.useState('')
  const [isMatchDialogOpen, setIsMatchDialogOpen] = React.useState(false)
  const [selectedCredit, setSelectedCredit] = React.useState<DisputedTransaction | null>(null)

  // Bulk selection for search results
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [isBulkProcessing, setIsBulkProcessing] = React.useState(false)
  const [isBulkDialogOpen, setIsBulkDialogOpen] = React.useState(false)
  const [bulkReason, setBulkReason] = React.useState('')

  // Bulk selection for disputes (for matching credits to multiple charges)
  const [selectedDisputeIds, setSelectedDisputeIds] = React.useState<Set<string>>(new Set())
  const [isBulkMatchDialogOpen, setIsBulkMatchDialogOpen] = React.useState(false)

  // Search filters
  const [searchFeeType, setSearchFeeType] = React.useState('')
  const [searchReferenceType, setSearchReferenceType] = React.useState('')
  const [searchReferenceId, setSearchReferenceId] = React.useState('')

  // Selection helpers
  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === searchResults.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(searchResults.map(t => t.transaction_id)))
    }
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
  }

  // Dispute selection helpers (for matching credits to multiple charges)
  const invalidDisputes = disputes.filter(d => d.dispute_status === 'invalid')

  const toggleDisputeSelected = (id: string) => {
    setSelectedDisputeIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAllDisputes = () => {
    if (selectedDisputeIds.size === invalidDisputes.length) {
      setSelectedDisputeIds(new Set())
    } else {
      setSelectedDisputeIds(new Set(invalidDisputes.map(t => t.transaction_id)))
    }
  }

  const clearDisputeSelection = () => {
    setSelectedDisputeIds(new Set())
  }

  React.useEffect(() => {
    fetchDisputes()
  }, [statusFilter])

  // Auto-search with debounce when filters change
  React.useEffect(() => {
    // Don't search if no filters are set
    if (!searchFeeType && !searchReferenceType && !searchReferenceId) {
      return
    }

    const timer = setTimeout(() => {
      searchTransactionsAuto()
    }, 300)

    return () => clearTimeout(timer)
  }, [searchFeeType, searchReferenceType, searchReferenceId])

  async function searchTransactionsAuto() {
    setIsSearching(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('search', 'true')
      if (searchFeeType) params.set('feeType', searchFeeType)
      if (searchReferenceType) params.set('referenceType', searchReferenceType)
      if (searchReferenceId) params.set('referenceId', searchReferenceId)

      const response = await fetch(`/api/admin/disputes?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to search transactions')
      const data = await response.json()
      setSearchResults(data.searchResults || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsSearching(false)
    }
  }

  async function fetchDisputes() {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter === 'pending') {
        // Show disputed and invalid
      } else if (statusFilter !== 'all') {
        params.set('status', statusFilter)
      } else {
        params.set('status', 'all')
      }
      params.set('unmatched', 'true')

      const response = await fetch(`/api/admin/disputes?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch disputes')
      const data = await response.json()
      setDisputes(data.disputes || [])
      setUnmatchedCredits(data.unmatchedCredits || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  async function searchByPreset(preset: string) {
    setIsSearching(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/disputes?search=true&preset=${preset}`)
      if (!response.ok) throw new Error('Failed to search transactions')
      const data = await response.json()
      setSearchResults(data.searchResults || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsSearching(false)
    }
  }

  function clearSearch() {
    setSearchResults([])
    setSearchFeeType('')
    setSearchReferenceType('')
    setSearchReferenceId('')
    clearSelection()
  }

  async function bulkMarkAsInvalid() {
    if (selectedIds.size === 0) return
    setIsBulkProcessing(true)
    setError(null)

    try {
      // Process each selected transaction
      const ids = Array.from(selectedIds)
      let successCount = 0

      for (const txId of ids) {
        const response = await fetch('/api/admin/disputes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_id: txId,
            status: 'invalid',
            reason: bulkReason,
            move_to_jetpack: true,
          }),
        })
        if (response.ok) {
          successCount++
        }
      }

      setIsBulkDialogOpen(false)
      setBulkReason('')
      clearSelection()

      // Remove processed transactions from search results
      setSearchResults(prev => prev.filter(t => !selectedIds.has(t.transaction_id)))

      // Refresh disputes list
      fetchDisputes()

      if (successCount < ids.length) {
        setError(`Marked ${successCount} of ${ids.length} transactions as invalid`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsBulkProcessing(false)
    }
  }

  async function markAsDisputed(transaction: DisputedTransaction, status: string, moveToJetpack: boolean) {
    try {
      const response = await fetch('/api/admin/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transaction.transaction_id,
          status,
          reason: disputeReason,
          move_to_jetpack: moveToJetpack,
        }),
      })
      if (!response.ok) throw new Error('Failed to update dispute')
      setIsDisputeDialogOpen(false)
      setDisputeReason('')
      // Refresh both disputes and clear from search results
      fetchDisputes()
      if (searchResults.length > 0) {
        setSearchResults(prev => prev.filter(t => t.transaction_id !== transaction.transaction_id))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  async function matchCreditToCharge(charge: DisputedTransaction, credit: DisputedTransaction) {
    try {
      const response = await fetch('/api/admin/disputes/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          charge_transaction_id: charge.transaction_id,
          credit_transaction_id: credit.transaction_id,
        }),
      })
      if (!response.ok) throw new Error('Failed to match transactions')
      setIsMatchDialogOpen(false)
      setSelectedCredit(null)
      fetchDisputes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  async function bulkMatchCreditToCharges(credit: DisputedTransaction) {
    if (selectedDisputeIds.size === 0) return
    setIsBulkProcessing(true)
    setError(null)

    try {
      const chargeIds = Array.from(selectedDisputeIds)
      const response = await fetch('/api/admin/disputes/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          charge_transaction_ids: chargeIds,
          credit_transaction_id: credit.transaction_id,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to match transactions')
      }

      setIsBulkMatchDialogOpen(false)
      setSelectedCredit(null)
      clearDisputeSelection()
      fetchDisputes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsBulkProcessing(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value)
  }

  if (isLoading) return null

  return (
    <div className="space-y-6">
      {/* Search for transactions to dispute */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Find Transactions to Dispute
          </CardTitle>
          <CardDescription>
            Search for transactions by fee type or reference to mark as invalid
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Manual Search */}
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label>Reference Type</Label>
              <Select value={searchReferenceType || '__any__'} onValueChange={(v) => setSearchReferenceType(v === '__any__' ? '' : v)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Any type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any</SelectItem>
                  <SelectItem value="URO">URO</SelectItem>
                  <SelectItem value="WRO">WRO</SelectItem>
                  <SelectItem value="Shipment">Shipment</SelectItem>
                  <SelectItem value="Return">Return</SelectItem>
                  <SelectItem value="FC">FC (Storage)</SelectItem>
                  <SelectItem value="Default">Default</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fee Type</Label>
              <Input
                placeholder="e.g., Storage Fee"
                value={searchFeeType}
                onChange={(e) => setSearchFeeType(e.target.value)}
                className="w-[200px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Reference ID</Label>
              <Input
                placeholder="e.g., 12345"
                value={searchReferenceId}
                onChange={(e) => setSearchReferenceId(e.target.value)}
                className="w-[150px]"
              />
            </div>
            {isSearching && (
              <JetpackLoader size="sm" />
            )}
            {(searchResults.length > 0 || searchFeeType || searchReferenceType || searchReferenceId) && (
              <Button variant="outline" size="sm" onClick={clearSearch}>
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>

          {/* Quick Filter Checkboxes */}
          <div className="mt-3 flex items-center gap-6 text-sm text-muted-foreground">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" className="rounded" onChange={(e) => e.target.checked && searchByPreset('unattributed')} disabled={isSearching} />
              Unattributed
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" className="rounded" onChange={(e) => e.target.checked && searchByPreset('orphaned_on_jetpack')} disabled={isSearching} />
              Orphaned on Jetpack
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" className="rounded" onChange={(e) => e.target.checked && searchByPreset('orphan_shipments')} disabled={isSearching} />
              Orphan Shipments
            </label>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium">Found {searchResults.length} transactions</h4>
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {selectedIds.size} selected
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setIsBulkDialogOpen(true)}
                    >
                      Mark {selectedIds.size} as Invalid
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearSelection}
                    >
                      Clear Selection
                    </Button>
                  </div>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === searchResults.length && searchResults.length > 0}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Fee Type</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchResults.map((tx) => (
                    <TableRow key={tx.transaction_id} className={selectedIds.has(tx.transaction_id) ? 'bg-muted/50' : ''}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(tx.transaction_id)}
                          onChange={() => toggleSelected(tx.transaction_id)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateFixed(tx.charge_date)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{tx.reference_type}</Badge>
                      </TableCell>
                      <TableCell>{tx.fee_type}</TableCell>
                      <TableCell className="font-mono text-xs">{tx.reference_id}</TableCell>
                      <TableCell>{tx.clients?.company_name || '-'}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(tx.cost)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setSelectedTransaction(tx)
                            setIsDisputeDialogOpen(true)
                          }}
                        >
                          Mark Invalid
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disputed Transactions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Disputed Transactions
              </CardTitle>
              <CardDescription>
                Transactions marked as invalid, awaiting credit matching
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending (Disputed/Invalid)</SelectItem>
                  <SelectItem value="disputed">Disputed</SelectItem>
                  <SelectItem value="invalid">Invalid</SelectItem>
                  <SelectItem value="credited">Credited</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={fetchDisputes}>
                <RefreshCw className="h-4 w-4 mr-1" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-md bg-destructive/15 p-3 text-destructive mb-4">
              {error}
            </div>
          )}

          {/* Bulk match button when charges selected */}
          {selectedDisputeIds.size > 0 && unmatchedCredits.length > 0 && (
            <div className="flex items-center gap-2 mb-4 p-2 bg-blue-50 rounded-md">
              <Badge variant="secondary">{selectedDisputeIds.size} selected</Badge>
              <span className="text-sm text-muted-foreground">
                Total: {formatCurrency(
                  disputes
                    .filter(t => selectedDisputeIds.has(t.transaction_id))
                    .reduce((sum, t) => sum + t.cost, 0)
                )}
              </span>
              <Button
                size="sm"
                variant="default"
                onClick={() => setIsBulkMatchDialogOpen(true)}
              >
                Match with Credit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearDisputeSelection}
              >
                Clear Selection
              </Button>
            </div>
          )}

          {disputes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No disputed transactions found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {invalidDisputes.length > 0 && unmatchedCredits.length > 0 && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedDisputeIds.size === invalidDisputes.length && invalidDisputes.length > 0}
                        onCheckedChange={toggleSelectAllDisputes}
                      />
                    </TableHead>
                  )}
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Fee Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {disputes.map((tx) => (
                  <TableRow key={tx.transaction_id} className={selectedDisputeIds.has(tx.transaction_id) ? 'bg-muted/50' : ''}>
                    {invalidDisputes.length > 0 && unmatchedCredits.length > 0 && (
                      <TableCell>
                        {tx.dispute_status === 'invalid' && (
                          <Checkbox
                            checked={selectedDisputeIds.has(tx.transaction_id)}
                            onCheckedChange={() => toggleDisputeSelected(tx.transaction_id)}
                          />
                        )}
                      </TableCell>
                    )}
                    <TableCell className="whitespace-nowrap">
                      {formatDateFixed(tx.charge_date)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{tx.reference_type}</Badge>
                    </TableCell>
                    <TableCell>{tx.fee_type}</TableCell>
                    <TableCell className="font-mono text-xs">{tx.reference_id}</TableCell>
                    <TableCell>{tx.clients?.company_name || '-'}</TableCell>
                    <TableCell className={cn(
                      "text-right font-medium",
                      tx.cost < 0 ? "text-green-600" : ""
                    )}>
                      {formatCurrency(tx.cost)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        tx.dispute_status === 'credited' ? 'default' :
                        tx.dispute_status === 'invalid' ? 'destructive' :
                        'secondary'
                      }>
                        {tx.dispute_status || 'none'}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={tx.dispute_reason || ''}>
                      {tx.dispute_reason || '-'}
                    </TableCell>
                    <TableCell>
                      {tx.dispute_status !== 'credited' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => {
                              setSelectedTransaction(tx)
                              setIsDisputeDialogOpen(true)
                            }}>
                              Mark as Invalid
                            </DropdownMenuItem>
                            {tx.dispute_status === 'invalid' && (
                              <DropdownMenuItem onClick={() => {
                                setSelectedTransaction(tx)
                                setIsMatchDialogOpen(true)
                              }}>
                                Match with Credit
                              </DropdownMenuItem>
                            )}
                            {tx.dispute_status && (
                              <DropdownMenuItem onClick={() => markAsDisputed(tx, '', false)}>
                                Clear Dispute
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {tx.dispute_status === 'credited' && tx.matched_credit_id && (
                        <span className="text-xs text-muted-foreground">
                          → {tx.matched_credit_id.slice(0, 8)}...
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Unmatched Credits Section */}
      {unmatchedCredits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-600" />
              Unmatched Credits
            </CardTitle>
            <CardDescription>
              Credits from ShipBob that haven&apos;t been matched to disputed charges
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Fee Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmatchedCredits.map((credit) => (
                  <TableRow key={credit.transaction_id}>
                    <TableCell>{formatDateFixed(credit.charge_date)}</TableCell>
                    <TableCell>{credit.fee_type}</TableCell>
                    <TableCell className="font-mono text-xs">{credit.reference_id}</TableCell>
                    <TableCell className="text-right font-medium text-green-600">
                      {formatCurrency(credit.cost)}
                    </TableCell>
                    <TableCell>{credit.invoice_id_sb || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Mark as Invalid Dialog */}
      <Dialog open={isDisputeDialogOpen} onOpenChange={setIsDisputeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Transaction as Invalid</DialogTitle>
            <DialogDescription>
              This transaction will be moved to the Jetpack system account and excluded from client billing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedTransaction && (
              <div className="rounded-md bg-muted p-3 space-y-1 text-sm">
                <p><strong>Fee Type:</strong> {selectedTransaction.fee_type}</p>
                <p><strong>Amount:</strong> {formatCurrency(selectedTransaction.cost)}</p>
                <p><strong>Reference:</strong> {selectedTransaction.reference_id}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Reason for dispute</Label>
              <Textarea
                placeholder="Explain why this charge is invalid..."
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDisputeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedTransaction && markAsDisputed(selectedTransaction, 'invalid', true)}
            >
              Mark as Invalid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Match Credit Dialog */}
      <Dialog open={isMatchDialogOpen} onOpenChange={setIsMatchDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Match Credit to Charge</DialogTitle>
            <DialogDescription>
              Select a credit to match with this invalid charge. Both will be marked as &quot;credited&quot;.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedTransaction && (
              <div className="rounded-md bg-muted p-3 space-y-1 text-sm">
                <p className="font-medium">Charge to match:</p>
                <p><strong>Fee Type:</strong> {selectedTransaction.fee_type}</p>
                <p><strong>Amount:</strong> {formatCurrency(selectedTransaction.cost)}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Select credit to match</Label>
              {unmatchedCredits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No unmatched credits available</p>
              ) : (
                <div className="border rounded-md max-h-[300px] overflow-auto">
                  {unmatchedCredits.map((credit) => (
                    <div
                      key={credit.transaction_id}
                      className={cn(
                        "p-3 border-b last:border-b-0 cursor-pointer hover:bg-muted/50",
                        selectedCredit?.transaction_id === credit.transaction_id && "bg-muted"
                      )}
                      onClick={() => setSelectedCredit(credit)}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="font-medium">{credit.fee_type}</p>
                          <p className="text-xs text-muted-foreground">{formatDateFixed(credit.charge_date)}</p>
                        </div>
                        <span className="text-green-600 font-medium">{formatCurrency(credit.cost)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedTransaction && selectedCredit && (
              <div className="rounded-md bg-blue-50 p-3 text-sm">
                <p className="font-medium">Net result:</p>
                <p>Charge: {formatCurrency(selectedTransaction.cost)}</p>
                <p>Credit: {formatCurrency(selectedCredit.cost)}</p>
                <p className="font-bold">Net: {formatCurrency(selectedTransaction.cost + selectedCredit.cost)}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMatchDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!selectedCredit}
              onClick={() => selectedTransaction && selectedCredit && matchCreditToCharge(selectedTransaction, selectedCredit)}
            >
              Match Transactions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Mark as Invalid Dialog */}
      <Dialog open={isBulkDialogOpen} onOpenChange={setIsBulkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {selectedIds.size} Transactions as Invalid</DialogTitle>
            <DialogDescription>
              These transactions will be moved to the Jetpack system account and excluded from client billing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-md bg-muted p-3 space-y-1 text-sm">
              <p><strong>Selected:</strong> {selectedIds.size} transactions</p>
              <p><strong>Total Amount:</strong> {formatCurrency(
                searchResults
                  .filter(t => selectedIds.has(t.transaction_id))
                  .reduce((sum, t) => sum + t.cost, 0)
              )}</p>
            </div>
            <div className="space-y-2">
              <Label>Reason for dispute (applies to all)</Label>
              <Textarea
                placeholder="Explain why these charges are invalid..."
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={bulkMarkAsInvalid}
              disabled={isBulkProcessing}
            >
              {isBulkProcessing ? (
                <>
                  <JetpackLoader size="sm" className="mr-1" />
                  Processing...
                </>
              ) : (
                `Mark ${selectedIds.size} as Invalid`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Match Credits to Multiple Charges Dialog */}
      <Dialog open={isBulkMatchDialogOpen} onOpenChange={setIsBulkMatchDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Match Credit to {selectedDisputeIds.size} Charges</DialogTitle>
            <DialogDescription>
              Select a credit to apply against the selected charges. All charges will be marked as credited.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-md bg-muted p-3 space-y-1 text-sm">
              <p><strong>Selected Charges:</strong> {selectedDisputeIds.size} transactions</p>
              <p><strong>Total Charges:</strong> {formatCurrency(
                disputes
                  .filter(t => selectedDisputeIds.has(t.transaction_id))
                  .reduce((sum, t) => sum + t.cost, 0)
              )}</p>
            </div>
            <div className="space-y-2">
              <Label>Select credit to apply</Label>
              {unmatchedCredits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No unmatched credits available</p>
              ) : (
                <div className="border rounded-md max-h-[300px] overflow-auto">
                  {unmatchedCredits.map((credit) => (
                    <div
                      key={credit.transaction_id}
                      className={cn(
                        "p-3 border-b last:border-b-0 cursor-pointer hover:bg-muted/50",
                        selectedCredit?.transaction_id === credit.transaction_id && "bg-muted"
                      )}
                      onClick={() => setSelectedCredit(credit)}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="font-medium">{credit.fee_type}</p>
                          <p className="text-xs text-muted-foreground">{formatDateFixed(credit.charge_date)}</p>
                        </div>
                        <span className="text-green-600 font-medium">{formatCurrency(credit.cost)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedCredit && (
              <div className="rounded-md bg-blue-50 p-3 text-sm">
                <p className="font-medium">Net result:</p>
                <p>Total Charges: {formatCurrency(
                  disputes
                    .filter(t => selectedDisputeIds.has(t.transaction_id))
                    .reduce((sum, t) => sum + t.cost, 0)
                )}</p>
                <p>Credit: {formatCurrency(selectedCredit.cost)}</p>
                <p className="font-bold">Net: {formatCurrency(
                  disputes
                    .filter(t => selectedDisputeIds.has(t.transaction_id))
                    .reduce((sum, t) => sum + t.cost, 0) + selectedCredit.cost
                )}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsBulkMatchDialogOpen(false)
              setSelectedCredit(null)
            }}>
              Cancel
            </Button>
            <Button
              disabled={!selectedCredit || isBulkProcessing}
              onClick={() => selectedCredit && bulkMatchCreditToCharges(selectedCredit)}
            >
              {isBulkProcessing ? (
                <>
                  <JetpackLoader size="sm" className="mr-1" />
                  Processing...
                </>
              ) : (
                `Match ${selectedDisputeIds.size} Charges`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SyncHealthContent() {
  const [data, setData] = React.useState<SyncHealthData | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    fetchHealth()
  }, [])

  async function fetchHealth() {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/sync-health')
      if (!response.ok) throw new Error('Failed to fetch sync health')
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sync health')
    } finally {
      setIsLoading(false)
    }
  }

  function getStatusColor(status: 'good' | 'warning' | 'critical') {
    switch (status) {
      case 'good':
        return 'text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950/50 dark:border-green-800'
      case 'warning':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950/50 dark:border-yellow-800'
      case 'critical':
        return 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/50 dark:border-red-800'
    }
  }

  function getStatusIcon(status: 'good' | 'warning' | 'critical') {
    switch (status) {
      case 'good':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />
      case 'critical':
        return <XCircle className="h-5 w-5 text-red-600" />
    }
  }

  if (isLoading) return null

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={fetchHealth}>Try Again</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Sync Health Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Data quality and sync metrics across all tables
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground">
            Last updated: {new Date(data.generatedAt).toLocaleTimeString()}
          </span>
          <Button variant="outline" onClick={fetchHealth} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Recent Activity Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Sync Activity (Last 24h)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold">{data.recentActivity.ordersLast24h.toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">Orders Synced</div>
            </div>
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold">{data.recentActivity.shipmentsLast24h.toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">Shipments Synced</div>
            </div>
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold">{data.recentActivity.transactionsLast24h.toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">Transactions Synced</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Quality Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Quality Metrics</CardTitle>
          <CardDescription>
            Key indicators for data completeness and sync health
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {data.metrics.map((metric) => (
              <div
                key={metric.label}
                className={cn(
                  'p-4 rounded-lg border',
                  getStatusColor(metric.status)
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {getStatusIcon(metric.status)}
                      <span className="font-medium">{metric.label}</span>
                    </div>
                    <p className="text-sm opacity-80 mb-2">{metric.description}</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold">{metric.percentage}%</span>
                      <span className="text-sm opacity-70">
                        ({metric.value.toLocaleString()} / {metric.total.toLocaleString()})
                      </span>
                    </div>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="mt-3 h-2 bg-black/10 dark:bg-white/20 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      metric.status === 'good' && 'bg-green-500',
                      metric.status === 'warning' && 'bg-yellow-500',
                      metric.status === 'critical' && 'bg-red-500'
                    )}
                    style={{ width: `${Math.min(metric.percentage, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Per-Client Timeline Health (if available) */}
      {data.clientHealth.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline Events by Client</CardTitle>
            <CardDescription>
              Percentage of delivered shipments with timeline events populated
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">With Timeline</TableHead>
                  <TableHead className="text-right">Total Delivered</TableHead>
                  <TableHead className="text-right">Coverage</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.clientHealth.map((client) => {
                  const status = client.timelinePercentage >= 90 ? 'good'
                    : client.timelinePercentage >= 70 ? 'warning' : 'critical'
                  return (
                    <TableRow key={client.clientId}>
                      <TableCell className="font-medium">{client.clientName}</TableCell>
                      <TableCell className="text-right">
                        {client.shipmentsWithTimeline.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {client.totalDeliveredShipments.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {client.timelinePercentage}%
                      </TableCell>
                      <TableCell>
                        {status === 'good' && (
                          <Badge className="bg-green-100 text-green-800 border-green-200">Good</Badge>
                        )}
                        {status === 'warning' && (
                          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Warning</Badge>
                        )}
                        {status === 'critical' && (
                          <Badge className="bg-red-100 text-red-800 border-red-200">Critical</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  )
}

// ============================================
// Brands Tab Content
// ============================================

interface BillingAddress {
  street: string
  city: string
  region: string
  postalCode: string
  country: string
}

interface ClientForManage {
  id: string
  company_name: string
  merchant_id: string | null
  short_code: string | null
  has_token: boolean
  billing_address?: BillingAddress | null
  billing_emails?: string[] | null
  billing_phone?: string | null
  billing_contact_name?: string | null
}

interface ConnectionTestResult {
  clientId: string
  status: 'idle' | 'testing' | 'success' | 'error'
  message?: string
  latency?: number
}

function BrandsContent({ clients }: { clients: Client[] }) {
  const { refreshClients } = useClient()

  const [testResults, setTestResults] = React.useState<
    Record<string, ConnectionTestResult>
  >({})
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [addClientOpen, setAddClientOpen] = React.useState(false)
  const [newClientName, setNewClientName] = React.useState('')
  const [newShipBobUserId, setNewShipBobUserId] = React.useState('')
  const [newShipBobToken, setNewShipBobToken] = React.useState('')
  const [newShortCode, setNewShortCode] = React.useState('')
  const [isAddingClient, setIsAddingClient] = React.useState(false)
  const [addClientError, setAddClientError] = React.useState<string | null>(null)

  // Manage client state
  const [manageOpen, setManageOpen] = React.useState(false)
  const [managingClient, setManagingClient] = React.useState<ClientForManage | null>(null)
  const [editCompanyName, setEditCompanyName] = React.useState('')
  const [editShipBobUserId, setEditShipBobUserId] = React.useState('')
  const [editShortCode, setEditShortCode] = React.useState('')
  const [editToken, setEditToken] = React.useState('')
  // Billing address fields
  const [editBillingStreet, setEditBillingStreet] = React.useState('')
  const [editBillingCity, setEditBillingCity] = React.useState('')
  const [editBillingRegion, setEditBillingRegion] = React.useState('')
  const [editBillingPostalCode, setEditBillingPostalCode] = React.useState('')
  const [editBillingCountry, setEditBillingCountry] = React.useState('')
  // Contact fields
  const [editBillingEmails, setEditBillingEmails] = React.useState<string[]>([])
  const [editBillingPhone, setEditBillingPhone] = React.useState('')
  const [editBillingContactName, setEditBillingContactName] = React.useState('')
  const [newEmailInput, setNewEmailInput] = React.useState('')
  const [isSaving, setIsSaving] = React.useState(false)
  const [isSavingToken, setIsSavingToken] = React.useState(false)
  const [isDeletingToken, setIsDeletingToken] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [manageError, setManageError] = React.useState<string | null>(null)
  const [manageSuccess, setManageSuccess] = React.useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)

  // Search state
  const [searchQuery, setSearchQuery] = React.useState('')

  // Filter clients based on search query
  const filteredClients = React.useMemo(() => {
    if (!searchQuery.trim()) return clients
    const query = searchQuery.toLowerCase()
    return clients.filter(client =>
      client.company_name.toLowerCase().includes(query) ||
      client.short_code?.toLowerCase().includes(query) ||
      client.merchant_id?.toLowerCase().includes(query)
    )
  }, [clients, searchQuery])

  const handleTestConnection = async (clientId: string) => {
    setTestResults((prev) => ({
      ...prev,
      [clientId]: { clientId, status: 'testing' },
    }))

    try {
      const response = await fetch(
        `/api/admin/clients/${clientId}/test-connection`,
        { method: 'POST' }
      )
      const data = await response.json()

      if (response.ok && data.success) {
        setTestResults((prev) => ({
          ...prev,
          [clientId]: {
            clientId,
            status: 'success',
            message: `Connected successfully`,
            latency: data.latency,
          },
        }))
      } else {
        setTestResults((prev) => ({
          ...prev,
          [clientId]: {
            clientId,
            status: 'error',
            message: data.error || 'Connection failed',
          },
        }))
      }
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [clientId]: {
          clientId,
          status: 'error',
          message: 'Network error',
        },
      }))
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await refreshClients()
    setIsRefreshing(false)
  }

  const handleAddClient = async () => {
    if (!newClientName.trim()) {
      setAddClientError('Company name is required')
      return
    }

    if (!newShipBobToken.trim()) {
      setAddClientError('ShipBob Token is required')
      return
    }

    setIsAddingClient(true)
    setAddClientError(null)

    try {
      // Validate short_code format (2-3 uppercase letters)
      const trimmedShortCode = newShortCode.trim().toUpperCase()
      if (trimmedShortCode && !/^[A-Z]{2,3}$/.test(trimmedShortCode)) {
        setAddClientError('Short code must be 2-3 uppercase letters')
        return
      }

      const response = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: newClientName.trim(),
          merchant_id: newShipBobUserId.trim() || null,
          shipbob_token: newShipBobToken.trim(),
          short_code: trimmedShortCode || null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setAddClientError(data.error || 'Failed to add client')
        return
      }

      // Success - close dialog, reset form, refresh list
      setAddClientOpen(false)
      setNewClientName('')
      setNewShipBobUserId('')
      setNewShipBobToken('')
      setNewShortCode('')
      await refreshClients()
    } catch {
      setAddClientError('Network error')
    } finally {
      setIsAddingClient(false)
    }
  }

  const openManageDialog = async (client: ClientForManage) => {
    // Always fetch fresh client data from API before opening dialog
    try {
      const response = await fetch(`/api/admin/clients/${client.id}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch client: ${response.status}`)
      }

      const freshClient = await response.json()

      setManagingClient(freshClient)
      setEditCompanyName(freshClient.company_name || '')
      setEditShipBobUserId(freshClient.merchant_id || '')
      setEditShortCode(freshClient.short_code || '')
      setEditToken('')
      // Initialize billing address fields
      setEditBillingStreet(freshClient.billing_address?.street || '')
      setEditBillingCity(freshClient.billing_address?.city || '')
      setEditBillingRegion(freshClient.billing_address?.region || '')
      setEditBillingPostalCode(freshClient.billing_address?.postalCode || '')
      setEditBillingCountry(freshClient.billing_address?.country || '')
      // Initialize contact fields with fresh data
      setEditBillingEmails(freshClient.billing_emails || [])
      setEditBillingPhone(freshClient.billing_phone || '')
      setEditBillingContactName(freshClient.billing_contact_name || '')
    } catch (error) {
      console.error('Error fetching fresh client data:', error)
      toast.error('Failed to load client data. Please try again.')
      // Don't open dialog if we can't fetch data
      return
    }

    setNewEmailInput('')
    setManageError(null)
    setManageSuccess(null)
    setShowDeleteConfirm(false)
    setManageOpen(true)
  }

  const handleSaveClientDetails = async () => {
    if (!managingClient) return
    if (!editCompanyName.trim()) {
      setManageError('Company name is required')
      return
    }

    // Validate short_code format (2-3 uppercase letters)
    const trimmedShortCode = editShortCode.trim().toUpperCase()
    if (trimmedShortCode && !/^[A-Z]{2,3}$/.test(trimmedShortCode)) {
      setManageError('Short code must be 2-3 uppercase letters')
      return
    }

    setIsSaving(true)
    setManageError(null)

    try {
      // Build billing address if any field is filled
      const hasBillingAddress = editBillingStreet || editBillingCity || editBillingRegion || editBillingPostalCode || editBillingCountry
      const billingAddress = hasBillingAddress ? {
        street: editBillingStreet.trim(),
        city: editBillingCity.trim(),
        region: editBillingRegion.trim(),
        postalCode: editBillingPostalCode.trim(),
        country: editBillingCountry.trim(),
      } : null

      const response = await fetch(`/api/admin/clients/${managingClient.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: editCompanyName.trim(),
          merchant_id: editShipBobUserId.trim() || null,
          short_code: trimmedShortCode || null,
          billing_address: billingAddress,
          billing_emails: editBillingEmails.length > 0 ? editBillingEmails : null,
          billing_phone: editBillingPhone.trim() || null,
          billing_contact_name: editBillingContactName.trim() || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setManageError(data.error || 'Failed to update')
        return
      }

      // Close dialog and refresh in background
      setManageOpen(false)
      refreshClients()
    } catch {
      setManageError('Network error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveToken = async () => {
    if (!managingClient) return
    if (!editToken.trim()) {
      setManageError('API token is required')
      return
    }

    setIsSavingToken(true)
    setManageError(null)

    try {
      const response = await fetch(`/api/admin/clients/${managingClient.id}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: editToken.trim() }),
      })

      if (!response.ok) {
        const data = await response.json()
        setManageError(data.error || 'Failed to save token')
        return
      }

      setManageSuccess('API token saved')
      setEditToken('')
      setManagingClient({ ...managingClient, has_token: true })
      await refreshClients()
      setTimeout(() => setManageSuccess(null), 2000)
    } catch {
      setManageError('Network error')
    } finally {
      setIsSavingToken(false)
    }
  }

  const handleDeleteToken = async () => {
    if (!managingClient) return

    setIsDeletingToken(true)
    setManageError(null)

    try {
      const response = await fetch(`/api/admin/clients/${managingClient.id}/token`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setManageError(data.error || 'Failed to delete token')
        return
      }

      setManageSuccess('API token removed')
      setManagingClient({ ...managingClient, has_token: false })
      await refreshClients()
      setTimeout(() => setManageSuccess(null), 2000)
    } catch {
      setManageError('Network error')
    } finally {
      setIsDeletingToken(false)
    }
  }

  const handleDeleteClient = async () => {
    if (!managingClient) return

    setIsDeleting(true)
    setManageError(null)

    try {
      const response = await fetch(`/api/admin/clients/${managingClient.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setManageError(data.error || 'Failed to delete brand')
        return
      }

      setManageOpen(false)
      await refreshClients()
    } catch {
      setManageError('Network error')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Brand Management
              </CardTitle>
              <CardDescription>
                Manage brand ShipBob API connections and tokens
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')}
                />
                Refresh
              </Button>
              <Dialog open={addClientOpen} onOpenChange={setAddClientOpen}>
                <Button variant="outline" size="sm" onClick={() => setAddClientOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Brand
                </Button>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Brand</DialogTitle>
                    <DialogDescription>
                      Add a new brand to manage their ShipBob integration.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="company_name">Company Name *</Label>
                      <Input
                        id="company_name"
                        placeholder="e.g., Henson Shaving"
                        value={newClientName}
                        onChange={(e) => setNewClientName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shipbob_token">ShipBob Token *</Label>
                      <Input
                        id="shipbob_token"
                        type="password"
                        placeholder="ShipBob API Token"
                        value={newShipBobToken}
                        onChange={(e) => setNewShipBobToken(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        The ShipBob API token for this brand (required for sync).
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shipbob_user_id">ShipBob User ID</Label>
                      <Input
                        id="shipbob_user_id"
                        placeholder="e.g., 386350 (optional)"
                        value={newShipBobUserId}
                        onChange={(e) => setNewShipBobUserId(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        The ShipBob merchant/user ID. Can be added later.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="short_code">Short Code (for invoices)</Label>
                      <Input
                        id="short_code"
                        placeholder="e.g., HS (2-3 letters)"
                        value={newShortCode}
                        onChange={(e) => setNewShortCode(e.target.value.toUpperCase())}
                        maxLength={3}
                      />
                      <p className="text-xs text-muted-foreground">
                        2-3 letter code for invoice numbers (e.g., JPHS-0001). Required for billing.
                      </p>
                    </div>
                    {addClientError && (
                      <div className="text-sm text-red-600 dark:text-red-400">
                        {addClientError}
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setAddClientOpen(false)}
                      disabled={isAddingClient}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleAddClient}
                      disabled={isAddingClient}
                    >
                      {isAddingClient ? (
                        <>
                          <JetpackLoader size="sm" className="mr-2" />
                          Adding...
                        </>
                      ) : (
                        'Add Brand'
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search bar */}
          {clients.length > 0 && (
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search brands..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {clients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No brands found. Add a brand to get started.
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No brands match &ldquo;{searchQuery}&rdquo;
            </div>
          ) : (
            <div className="space-y-4">
              {filteredClients.map((client) => {
                const testResult = testResults[client.id]
                return (
                  <div
                    key={client.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="font-medium">{client.company_name}</div>
                        <div className="text-sm text-muted-foreground">
                          ShipBob User ID: {client.merchant_id || 'Not set'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {client.has_token ? (
                        <Badge
                          variant="outline"
                          className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Token Active
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800"
                        >
                          <AlertCircle className="h-3 w-3 mr-1" />
                          No Token
                        </Badge>
                      )}

                      {testResult?.status === 'success' && (
                        <Badge
                          variant="outline"
                          className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {testResult.latency}ms
                        </Badge>
                      )}
                      {testResult?.status === 'error' && (
                        <Badge
                          variant="outline"
                          className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
                        >
                          <AlertCircle className="h-3 w-3 mr-1" />
                          {testResult.message}
                        </Badge>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestConnection(client.id)}
                        disabled={
                          !client.has_token || testResult?.status === 'testing'
                        }
                      >
                        {testResult?.status === 'testing' ? (
                          <>
                            <JetpackLoader size="sm" className="mr-2" />
                            Testing...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Test
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openManageDialog(client as ClientForManage)}
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        Manage
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manage Brand Dialog */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Brand</DialogTitle>
            <DialogDescription>
              Edit brand details, manage API tokens, or delete this brand.
            </DialogDescription>
          </DialogHeader>

          {managingClient && (
            <div className="space-y-4 py-2">
              {/* Two-column layout for Brand Details and Billing */}
              <div className="grid grid-cols-2 gap-6">
                {/* Left Column: Brand Details + Billing Address */}
                <div className="space-y-4">
                  {/* Brand Details Card */}
                  <div className="rounded-lg border bg-card p-4 space-y-3">
                    <h3 className="font-medium flex items-center gap-2 text-sm pb-2 border-b">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      Brand Details
                    </h3>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="edit_company_name" className="text-xs">Company Name *</Label>
                        <Input
                          id="edit_company_name"
                          value={editCompanyName}
                          onChange={(e) => setEditCompanyName(e.target.value)}
                          className="h-8"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="edit_shipbob_id" className="text-xs">ShipBob User ID</Label>
                          <Input
                            id="edit_shipbob_id"
                            value={editShipBobUserId}
                            onChange={(e) => setEditShipBobUserId(e.target.value)}
                            placeholder="e.g., 386350"
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="edit_short_code" className="text-xs">Short Code</Label>
                          <Input
                            id="edit_short_code"
                            value={editShortCode}
                            onChange={(e) => setEditShortCode(e.target.value.toUpperCase())}
                            placeholder="e.g., HS"
                            maxLength={3}
                            className="h-8"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Billing Address Card */}
                  <div className="rounded-lg border bg-card p-4 space-y-3">
                    <h3 className="font-medium flex items-center gap-2 text-sm pb-2 border-b">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      Billing Address
                    </h3>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit_billing_street" className="text-xs">Street</Label>
                      <Input
                        id="edit_billing_street"
                        value={editBillingStreet}
                        onChange={(e) => setEditBillingStreet(e.target.value)}
                        placeholder="123 Main St, Suite 400"
                        className="h-8"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="edit_billing_city" className="text-xs">City</Label>
                        <Input
                          id="edit_billing_city"
                          value={editBillingCity}
                          onChange={(e) => setEditBillingCity(e.target.value)}
                          placeholder="Toronto"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit_billing_region" className="text-xs">Province/State</Label>
                        <Input
                          id="edit_billing_region"
                          value={editBillingRegion}
                          onChange={(e) => setEditBillingRegion(e.target.value)}
                          placeholder="ON"
                          className="h-8"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="edit_billing_postal" className="text-xs">Postal/ZIP</Label>
                        <Input
                          id="edit_billing_postal"
                          value={editBillingPostalCode}
                          onChange={(e) => setEditBillingPostalCode(e.target.value)}
                          placeholder="M5V 1K4"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit_billing_country" className="text-xs">Country</Label>
                        <Input
                          id="edit_billing_country"
                          value={editBillingCountry}
                          onChange={(e) => setEditBillingCountry(e.target.value)}
                          placeholder="CANADA"
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Billing Contact + API Token */}
                <div className="space-y-4">
                  {/* Billing Contact Card */}
                  <div className="rounded-lg border bg-card p-4 space-y-3">
                    <h3 className="font-medium flex items-center gap-2 text-sm pb-2 border-b">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      Billing Contact
                    </h3>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit_billing_contact_name" className="text-xs">Primary Contact</Label>
                      <div className="relative">
                        <User className="h-3.5 w-3.5 absolute left-2.5 top-2 text-muted-foreground" />
                        <Input
                          id="edit_billing_contact_name"
                          value={editBillingContactName}
                          onChange={(e) => setEditBillingContactName(e.target.value)}
                          placeholder="John Smith"
                          className="pl-8 h-8"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit_billing_phone" className="text-xs">Phone</Label>
                      <div className="relative">
                        <Phone className="h-3.5 w-3.5 absolute left-2.5 top-2 text-muted-foreground" />
                        <Input
                          id="edit_billing_phone"
                          value={editBillingPhone}
                          onChange={(e) => setEditBillingPhone(e.target.value)}
                          placeholder="+1 (555) 123-4567"
                          className="pl-8 h-8"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Billing Emails</Label>
                      <div className="flex flex-wrap gap-1 min-h-[24px] p-1.5 border rounded-md bg-muted/30">
                        {editBillingEmails.length === 0 && (
                          <span className="text-xs text-muted-foreground">No emails added</span>
                        )}
                        {editBillingEmails.map((email, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded text-xs"
                          >
                            {email}
                            <button
                              type="button"
                              onClick={() => setEditBillingEmails(editBillingEmails.filter((_, i) => i !== index))}
                              className="hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        <Input
                          value={newEmailInput}
                          onChange={(e) => setNewEmailInput(e.target.value)}
                          placeholder="Add email"
                          className="h-8"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newEmailInput.trim()) {
                              e.preventDefault()
                              if (newEmailInput.includes('@') && !editBillingEmails.includes(newEmailInput.trim())) {
                                setEditBillingEmails([...editBillingEmails, newEmailInput.trim()])
                                setNewEmailInput('')
                              }
                            }
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 px-3"
                          onClick={() => {
                            if (newEmailInput.trim() && newEmailInput.includes('@') && !editBillingEmails.includes(newEmailInput.trim())) {
                              setEditBillingEmails([...editBillingEmails, newEmailInput.trim()])
                              setNewEmailInput('')
                            }
                          }}
                          disabled={!newEmailInput.trim() || !newEmailInput.includes('@')}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* API Token Card */}
                  <div className="rounded-lg border bg-card p-4 space-y-3">
                    <h3 className="font-medium flex items-center gap-2 text-sm pb-2 border-b">
                      <Key className="h-4 w-4 text-muted-foreground" />
                      API Token
                    </h3>
                    {managingClient.has_token ? (
                      <div className="flex items-center justify-between p-2 bg-green-50 dark:bg-green-950 rounded border border-green-200 dark:border-green-800">
                        <div className="flex items-center gap-1.5 text-green-700 dark:text-green-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span className="text-xs font-medium">Token configured</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleDeleteToken}
                          disabled={isDeletingToken}
                          className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          {isDeletingToken ? (
                            <JetpackLoader size="sm" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 p-2 bg-yellow-50 dark:bg-yellow-950 rounded border border-yellow-200 dark:border-yellow-800">
                        <AlertCircle className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
                        <span className="text-xs text-yellow-700 dark:text-yellow-300">No token</span>
                      </div>
                    )}
                    <div className="flex gap-1.5">
                      <Input
                        id="edit_token"
                        type="password"
                        value={editToken}
                        onChange={(e) => setEditToken(e.target.value)}
                        placeholder="pat_xxxxxxxx..."
                        className="h-8"
                      />
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={handleSaveToken}
                        disabled={isSavingToken || !editToken.trim()}
                      >
                        {isSavingToken ? (
                          <JetpackLoader size="sm" />
                        ) : (
                          <Key className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Save Button - Full Width */}
              <div className="pt-2">
                <Button
                  onClick={handleSaveClientDetails}
                  disabled={isSaving}
                  className="w-full"
                >
                  {isSaving ? (
                    <JetpackLoader size="sm" className="mr-2" />
                  ) : null}
                  Save All Changes
                </Button>
              </div>

              {/* Status Messages */}
              {manageError && (
                <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {manageError}
                </div>
              )}
              {manageSuccess && (
                <div className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  {manageSuccess}
                </div>
              )}

              {/* Delete Section - Collapsed by default */}
              <div className="pt-3 border-t">
                {!showDeleteConfirm ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-xs text-muted-foreground hover:text-red-600"
                  >
                    <Trash2 className="h-3 w-3 mr-1.5" />
                    Delete Brand...
                  </Button>
                ) : (
                  <div className="p-3 border border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-950 space-y-2">
                    <p className="text-xs text-red-700 dark:text-red-300">
                      Delete <strong>{managingClient.company_name}</strong>? This cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setShowDeleteConfirm(false)}
                        disabled={isDeleting}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleDeleteClient}
                        disabled={isDeleting}
                      >
                        {isDeleting ? (
                          <JetpackLoader size="sm" className="mr-1.5" />
                        ) : (
                          <Trash2 className="h-3 w-3 mr-1.5" />
                        )}
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setManageOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// =========================================
// Warehouses Tab Content
// =========================================

interface FulfillmentCenter {
  id: number
  name: string
  country: string
  state_province: string | null
  tax_rate: number | null
  tax_type: string | null
  auto_detected: boolean
  created_at: string
  updated_at: string
}

function WarehousesContent() {
  const [warehouses, setWarehouses] = React.useState<FulfillmentCenter[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isScanning, setIsScanning] = React.useState(false)
  const [scanResult, setScanResult] = React.useState<{
    message: string
    newCount: number
    added: Array<{ name: string; country: string; state_province: string | null }>
  } | null>(null)
  const [editingId, setEditingId] = React.useState<number | null>(null)
  const [editValues, setEditValues] = React.useState<{
    country: string
    tax_rate: string
    tax_type: string
  }>({ country: '', tax_rate: '', tax_type: '' })
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    fetchWarehouses()
  }, [])

  async function fetchWarehouses() {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/warehouses')
      if (!response.ok) throw new Error('Failed to fetch warehouses')
      const result = await response.json()
      setWarehouses(result.fulfillmentCenters || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load warehouses')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleScan() {
    setIsScanning(true)
    setScanResult(null)
    try {
      const response = await fetch('/api/admin/warehouses/scan', { method: 'POST' })
      if (!response.ok) throw new Error('Failed to scan for new warehouses')
      const result = await response.json()
      setScanResult({
        message: result.message,
        newCount: result.newCount,
        added: result.added || [],
      })
      // Refresh the list if new ones were added
      if (result.newCount > 0) {
        await fetchWarehouses()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setIsScanning(false)
    }
  }

  function startEditing(fc: FulfillmentCenter) {
    setEditingId(fc.id)
    setEditValues({
      country: fc.country,
      tax_rate: fc.tax_rate?.toString() || '',
      tax_type: fc.tax_type || '',
    })
  }

  function cancelEditing() {
    setEditingId(null)
    setEditValues({ country: '', tax_rate: '', tax_type: '' })
  }

  async function saveEditing(id: number) {
    setIsSaving(true)
    try {
      const response = await fetch('/api/admin/warehouses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          country: editValues.country,
          tax_rate: editValues.tax_rate === '' ? null : Number(editValues.tax_rate),
          tax_type: editValues.tax_type || null,
        }),
      })
      if (!response.ok) throw new Error('Failed to save changes')
      const result = await response.json()
      // Update local state
      setWarehouses(prev =>
        prev.map(fc => (fc.id === id ? result.fulfillmentCenter : fc))
      )
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) return null

  if (error && warehouses.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={fetchWarehouses}>Try Again</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Fulfillment Centers</h2>
          <p className="text-sm text-muted-foreground">
            Manage warehouse locations and tax settings. Canadian FCs require tax rates for invoicing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchWarehouses} disabled={isLoading}>
            <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
            Refresh
          </Button>
          <Button onClick={handleScan} disabled={isScanning}>
            {isScanning ? (
              <>
                <JetpackLoader size="sm" className="mr-2" />
                Scanning...
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Scan for New Warehouses
              </>
            )}
          </Button>
        </div>
      </div>

      {scanResult && (
        <Card className={cn(
          'border',
          scanResult.newCount > 0
            ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
            : 'border-muted'
        )}>
          <CardContent className="py-4">
            <div className="flex items-center gap-2">
              {scanResult.newCount > 0 ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <Activity className="h-5 w-5 text-muted-foreground" />
              )}
              <span className="font-medium">{scanResult.message}</span>
            </div>
            {scanResult.added.length > 0 && (
              <div className="mt-2 pl-7">
                <ul className="text-sm text-muted-foreground">
                  {scanResult.added.map((fc, i) => (
                    <li key={i}>
                      {fc.country === 'CA' ? '🍁' : '🇺🇸'} {fc.name} ({fc.country}, {fc.state_province || 'unknown'})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            All Warehouses ({warehouses.length})
          </CardTitle>
          <CardDescription>
            Click a row to edit. Country, tax rate, and tax type can be manually set and won&apos;t be overwritten by sync.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">State/Province</TableHead>
                <TableHead className="w-28">Country</TableHead>
                <TableHead className="w-28">Tax Rate</TableHead>
                <TableHead className="w-28">Tax Type</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warehouses.map(fc => (
                <TableRow key={fc.id} className={cn(editingId === fc.id && 'bg-muted/50')}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {fc.name}
                      {!fc.auto_detected && (
                        <Badge variant="outline" className="text-xs">Manual</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="w-28">{fc.state_province || '-'}</TableCell>
                  <TableCell className="w-28">
                    {editingId === fc.id ? (
                      <Select
                        value={editValues.country}
                        onValueChange={(value) => setEditValues(prev => ({ ...prev, country: value }))}
                      >
                        <SelectTrigger className="w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="US">US</SelectItem>
                          <SelectItem value="CA">CA</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={fc.country === 'CA' ? 'secondary' : 'outline'}>
                        {fc.country}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="w-28">
                    {editingId === fc.id ? (
                      <input
                        type="number"
                        step="0.01"
                        className="w-20 px-2 py-1 border rounded text-sm"
                        value={editValues.tax_rate}
                        onChange={(e) => setEditValues(prev => ({ ...prev, tax_rate: e.target.value }))}
                        placeholder="0.00"
                      />
                    ) : (
                      fc.tax_rate ? `${fc.tax_rate}%` : '-'
                    )}
                  </TableCell>
                  <TableCell className="w-28">
                    {editingId === fc.id ? (
                      <input
                        type="text"
                        className="w-20 px-2 py-1 border rounded text-sm"
                        value={editValues.tax_type}
                        onChange={(e) => setEditValues(prev => ({ ...prev, tax_type: e.target.value }))}
                        placeholder="e.g. HST"
                      />
                    ) : (
                      fc.tax_type || '-'
                    )}
                  </TableCell>
                  <TableCell className="w-28 text-right">
                    {editingId === fc.id ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={cancelEditing}
                          disabled={isSaving}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveEditing(fc.id)}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <JetpackLoader size="sm" />
                          ) : (
                            <>
                              <Save className="h-4 w-4 mr-1" />
                              Save
                            </>
                          )}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEditing(fc)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {warehouses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No warehouses found. Click &quot;Scan for New Warehouses&quot; to detect FCs from transaction data.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}

// ============================================
// Care Team Tab Content
// ============================================

interface CareUser {
  id: string
  email: string
  full_name?: string
  role: 'care_admin' | 'care_team'
  created_at: string
}

function CareTeamContent() {
  const [careUsers, setCareUsers] = React.useState<CareUser[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  // Form state
  const [newEmail, setNewEmail] = React.useState('')
  const [newFullName, setNewFullName] = React.useState('')
  const [newRole, setNewRole] = React.useState<'care_admin' | 'care_team'>('care_team')

  // Fetch care users
  const fetchCareUsers = React.useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await fetch('/api/admin/care-users')
      if (!response.ok) {
        throw new Error('Failed to fetch care users')
      }
      const data = await response.json()
      setCareUsers(data.users || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load care users')
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchCareUsers()
  }, [fetchCareUsers])

  // Create new care user
  const handleCreateUser = async () => {
    if (!newEmail.trim()) {
      setError('Email is required')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)

      const response = await fetch('/api/admin/care-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail.trim(),
          role: newRole,
          full_name: newFullName.trim() || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create user')
      }

      // Reset form and close dialog
      setNewEmail('')
      setNewFullName('')
      setNewRole('care_team')
      setIsDialogOpen(false)

      // Refresh user list
      await fetchCareUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Update user role
  const handleUpdateRole = async (userId: string, newRole: 'care_admin' | 'care_team') => {
    try {
      setError(null)
      const response = await fetch(`/api/admin/care-users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update user')
      }

      await fetchCareUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user')
    }
  }

  // Remove user from care team
  const handleRemoveUser = async (userId: string) => {
    try {
      setError(null)
      const response = await fetch(`/api/admin/care-users/${userId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove user')
      }

      await fetchCareUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user')
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Jetpack Care Team
              </CardTitle>
              <CardDescription>
                Manage users who have access to Jetpack Care for ticket management and client support.
              </CardDescription>
            </div>
            <Button onClick={() => setIsDialogOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Care User
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <JetpackLoader size="md" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {careUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{user.full_name || 'No name'}</span>
                        <span className="text-sm text-muted-foreground">{user.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={user.role}
                        onValueChange={(value: 'care_admin' | 'care_team') =>
                          handleUpdateRole(user.id, value)
                        }
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="care_admin">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-4 w-4 text-amber-600" />
                              Care Admin
                            </div>
                          </SelectItem>
                          <SelectItem value="care_team">
                            <div className="flex items-center gap-2">
                              <Shield className="h-4 w-4 text-blue-600" />
                              Care Team
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(user.created_at)}
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveUser(user.id)}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Remove from Care Team</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
                {careUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No Care team members yet. Click &quot;Add Care User&quot; to add someone.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Role Descriptions Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Role Descriptions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium">Care Admin</p>
              <p className="text-sm text-muted-foreground">
                Full access to Jetpack Care. Can view all tickets across all clients,
                edit ticket details, update statuses, and manage resolutions.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
            <div>
              <p className="font-medium">Care Team</p>
              <p className="text-sm text-muted-foreground">
                View-only access to Jetpack Care. Can see all tickets across all clients
                but cannot make changes or updates.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Care Team Member</DialogTitle>
            <DialogDescription>
              Add a new user to the Jetpack Care team. They will receive an email invitation to set up their account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name (optional)</Label>
              <Input
                id="fullName"
                placeholder="John Doe"
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={newRole} onValueChange={(v: 'care_admin' | 'care_team') => setNewRole(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="care_admin">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-amber-600" />
                      Care Admin - Full access
                    </div>
                  </SelectItem>
                  <SelectItem value="care_team">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-blue-600" />
                      Care Team - View only
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <JetpackLoader size="sm" className="mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add User
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ============================================
// Orphans Tab Content - Unattributed Transactions
// ============================================

interface OrphanedTransaction {
  transaction_id: string
  reference_id: string | null
  reference_type: string | null
  fee_type: string | null
  cost: number | null
  charge_date: string | null
  tracking_id: string | null
  fulfillment_center: string | null
  additional_details: Record<string, unknown> | null
  invoice_id_sb: number | null
  created_at: string | null
}

interface OrphansSummary {
  byFeeType: Record<string, number>
  byReferenceType: Record<string, number>
  totalCost: number
}

function OrphansContent({ clients }: { clients: Client[] }) {
  const [transactions, setTransactions] = React.useState<OrphanedTransaction[]>([])
  const [summary, setSummary] = React.useState<OrphansSummary | null>(null)
  const [total, setTotal] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [feeTypeFilter, setFeeTypeFilter] = React.useState<string>('all')
  const [refTypeFilter, setRefTypeFilter] = React.useState<string>('all')

  // Multi-select state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [bulkClientId, setBulkClientId] = React.useState<string>('')
  const [isBulkLinking, setIsBulkLinking] = React.useState(false)

  // Auto-refresh interval
  const [autoRefresh, setAutoRefresh] = React.useState(true)
  const [lastRefreshed, setLastRefreshed] = React.useState<Date | null>(null)

  const fetchOrphans = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (feeTypeFilter && feeTypeFilter !== 'all') {
        params.set('feeType', feeTypeFilter)
      }
      if (refTypeFilter && refTypeFilter !== 'all') {
        params.set('referenceType', refTypeFilter)
      }

      const response = await fetch(`/api/admin/orphans?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch orphaned transactions')
      const data = await response.json()
      setTransactions(data.transactions || [])
      setSummary(data.summary || null)
      setTotal(data.total || 0)
      setLastRefreshed(new Date())
      // Clear selection when data changes
      setSelectedIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orphaned transactions')
    } finally {
      setIsLoading(false)
    }
  }, [feeTypeFilter, refTypeFilter])

  // Initial fetch and filter change
  React.useEffect(() => {
    fetchOrphans()
  }, [fetchOrphans])

  // Auto-refresh every 30 seconds
  React.useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      fetchOrphans()
    }, 30000) // 30 seconds

    return () => clearInterval(interval)
  }, [autoRefresh, fetchOrphans])

  // Selection helpers
  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === transactions.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(transactions.map(t => t.transaction_id)))
    }
  }

  // Inline link transaction
  async function handleInlineLink(transactionId: string, clientId: string) {
    try {
      const response = await fetch(`/api/admin/transactions/${transactionId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      if (response.ok) {
        await fetchOrphans()
      }
    } catch (err) {
      console.error('Failed to link transaction:', err)
    }
  }

  // Bulk link transactions
  async function handleBulkLink() {
    if (!bulkClientId || selectedIds.size === 0) return

    setIsBulkLinking(true)
    try {
      // Link each selected transaction
      const promises = Array.from(selectedIds).map(transactionId =>
        fetch(`/api/admin/transactions/${transactionId}/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: bulkClientId }),
        })
      )
      await Promise.all(promises)
      await fetchOrphans()
      setBulkClientId('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link transactions')
    } finally {
      setIsBulkLinking(false)
    }
  }

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return '-'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // Get unique fee types and reference types for filters
  const feeTypes = summary ? Object.keys(summary.byFeeType).sort() : []
  const refTypes = summary ? Object.keys(summary.byReferenceType).sort() : []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Orphaned Transactions
            </CardTitle>
            <CardDescription>
              Transactions missing client attribution that need manual assignment
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {lastRefreshed && (
                <span>Updated {lastRefreshed.toLocaleTimeString()}</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={cn(autoRefresh && 'text-green-600')}
              >
                <Activity className={cn('h-4 w-4', autoRefresh && 'animate-pulse')} />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchOrphans}
              disabled={isLoading}
            >
              {isLoading ? (
                <JetpackLoader size="sm" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        {summary && total > 0 && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-amber-600">{total}</div>
                <div className="text-xs text-muted-foreground">Unattributed Transactions</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{formatCurrency(summary.totalCost)}</div>
                <div className="text-xs text-muted-foreground">Total Value</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{Object.keys(summary.byFeeType).length}</div>
                <div className="text-xs text-muted-foreground">Fee Types</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{Object.keys(summary.byReferenceType).length}</div>
                <div className="text-xs text-muted-foreground">Reference Types</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters and Bulk Actions */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Fee Type:</Label>
              <Select value={feeTypeFilter} onValueChange={setFeeTypeFilter}>
                <SelectTrigger className="w-[150px] h-8">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {feeTypes.map(type => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Reference Type:</Label>
              <Select value={refTypeFilter} onValueChange={setRefTypeFilter}>
                <SelectTrigger className="w-[150px] h-8">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {refTypes.map(type => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Bulk Actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 rounded-lg">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                {selectedIds.size} selected
              </span>
              <Select value={bulkClientId} onValueChange={setBulkClientId}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue placeholder="Attribute to..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__jetpack_parent__" className="text-xs font-medium text-blue-600">
                    Jetpack (Parent)
                  </SelectItem>
                  <div className="h-px bg-border my-1" />
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.short_code ? `[${c.short_code}] ` : ''}{c.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleBulkLink}
                disabled={!bulkClientId || isBulkLinking}
                className="h-8"
              >
                {isBulkLinking ? (
                  <JetpackLoader size="sm" />
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Apply
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                className="h-8 px-2"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* Transactions Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <JetpackLoader size="lg" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <p className="text-lg font-medium">No orphaned transactions!</p>
            <p className="text-sm">All transactions have been attributed to clients.</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={selectedIds.size === transactions.length && transactions.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Fee Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Ref Type</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Attribute to</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.transaction_id} className={selectedIds.has(tx.transaction_id) ? 'bg-blue-50 dark:bg-blue-950/20' : ''}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(tx.transaction_id)}
                        onCheckedChange={() => toggleSelected(tx.transaction_id)}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{tx.fee_type || '-'}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tx.reference_id || '-'}
                    </TableCell>
                    <TableCell className="text-xs">{tx.reference_type || '-'}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatCurrency(tx.cost)}
                    </TableCell>
                    <TableCell className="text-xs">{formatDate(tx.charge_date)}</TableCell>
                    <TableCell className="max-w-[150px]">
                      {tx.additional_details && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs text-muted-foreground truncate block cursor-help">
                                {tx.additional_details.Comment
                                  ? String(tx.additional_details.Comment).slice(0, 30)
                                  : tx.fulfillment_center || '-'}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <pre className="text-xs max-w-md whitespace-pre-wrap">
                                {JSON.stringify(tx.additional_details, null, 2)}
                              </pre>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        onValueChange={(clientId) => handleInlineLink(tx.transaction_id, clientId)}
                      >
                        <SelectTrigger className="h-7 w-[140px] text-xs">
                          <SelectValue placeholder="Select client..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__jetpack_parent__" className="text-xs font-medium text-blue-600">
                            Jetpack (Parent)
                          </SelectItem>
                          <div className="h-px bg-border my-1" />
                          {clients.map(c => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">
                              {c.short_code ? `[${c.short_code}] ` : ''}{c.company_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ============================================
// Commissions Tab Content
// ============================================

interface CommissionAssignmentRaw {
  id: string
  user_id: string
  start_date: string
  is_active: boolean
  commission_type: {
    id: string
    name: string
  } | null
  clients: Array<{
    id: string
    client_id: string
    client: {
      id: string
      company_name: string
    } | null
  }>
}

interface CommissionAssignment {
  id: string
  user_id: string
  commission_type_name: string
  start_date: string
  is_active: boolean
  clients: Array<{
    client_id: string
    client_name: string
  }>
}

interface CommissionTypeOption {
  id: string
  name: string
  formula_type: string
  formula_params: { C: number; K: number }
}

interface EshipperStats {
  total_shipments: number
  date_range: {
    earliest: string
    latest: string
  }
  by_client: Array<{
    client_name: string
    shipments: number
  }>
  by_month: Array<{
    month: string
    year: number
    monthNum: number
    total: number
    byClient: Array<{
      client_name: string
      shipments: number
    }>
  }>
}

interface ParentUser {
  id: string
  email: string
  full_name?: string
  role?: string
}

function CommissionsContent({ clients }: { clients: Client[] }) {
  const [assignments, setAssignments] = React.useState<CommissionAssignment[]>([])
  const [commissionTypes, setCommissionTypes] = React.useState<CommissionTypeOption[]>([])
  const [parentUsers, setParentUsers] = React.useState<ParentUser[]>([])
  const [eshipperStats, setEshipperStats] = React.useState<EshipperStats | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isUploading, setIsUploading] = React.useState(false)
  const [uploadResult, setUploadResult] = React.useState<{
    success: boolean
    message: string
    details?: Record<string, number>
  } | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [dialogError, setDialogError] = React.useState<string | null>(null)

  // Form state
  const [selectedUserId, setSelectedUserId] = React.useState('')
  const [selectedCommissionTypeId, setSelectedCommissionTypeId] = React.useState('')
  const [selectedClientIds, setSelectedClientIds] = React.useState<string[]>([])
  const [startDate, setStartDate] = React.useState(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })

  // Fetch commission assignments, types, and eShipper stats
  const fetchData = React.useCallback(async () => {
    try {
      setIsLoading(true)

      const [assignmentsRes, typesRes, statsRes, usersRes] = await Promise.all([
        fetch('/api/admin/user-commissions'),
        fetch('/api/admin/commission-types'),
        fetch('/api/admin/eshipper-stats'),
        fetch('/api/admin/parent-users'),
      ])

      if (assignmentsRes.ok) {
        const data = await assignmentsRes.json()
        // Transform raw data to UI format
        const rawAssignments: CommissionAssignmentRaw[] = data.data || []
        const transformed: CommissionAssignment[] = rawAssignments.map(a => ({
          id: a.id,
          user_id: a.user_id,
          commission_type_name: a.commission_type?.name || 'Unknown',
          start_date: a.start_date,
          is_active: a.is_active,
          clients: (a.clients || [])
            .filter(c => c.client)
            .map(c => ({
              client_id: c.client_id,
              client_name: c.client?.company_name || 'Unknown',
            })),
        }))
        setAssignments(transformed)
      }

      if (typesRes.ok) {
        const data = await typesRes.json()
        setCommissionTypes(data.data || [])
      }

      if (statsRes.ok) {
        const data = await statsRes.json()
        setEshipperStats(data)
      }

      if (usersRes.ok) {
        const data = await usersRes.json()
        setParentUsers(data.data || [])
      }
    } catch (err) {
      console.error('Error fetching commission data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchData()
  }, [fetchData])

  // Handle create commission assignment
  const handleCreateAssignment = async () => {
    if (!selectedUserId) {
      setDialogError('Please select a user')
      return
    }
    if (!selectedCommissionTypeId) {
      setDialogError('Commission type is required')
      return
    }

    try {
      setIsSubmitting(true)
      setDialogError(null)

      const response = await fetch('/api/admin/user-commissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: selectedUserId.trim(),
          commission_type_id: selectedCommissionTypeId,
          start_date: startDate,
          client_ids: selectedClientIds,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create assignment')
      }

      // Reset form and close dialog
      setSelectedUserId('')
      setSelectedCommissionTypeId('')
      setSelectedClientIds([])
      setStartDate(new Date().toISOString().split('T')[0])
      setIsDialogOpen(false)

      // Refresh data
      await fetchData()
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Failed to create assignment')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle delete commission assignment
  const handleDeleteAssignment = async (id: string) => {
    if (!confirm('Are you sure you want to delete this commission assignment?')) {
      return
    }

    try {
      const response = await fetch(`/api/admin/user-commissions?id=${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete assignment')
      }

      await fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete assignment')
    }
  }

  // Toggle client selection
  const toggleClient = (clientId: string) => {
    setSelectedClientIds(prev =>
      prev.includes(clientId)
        ? prev.filter(id => id !== clientId)
        : [...prev, clientId]
    )
  }

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)

    try {
      setIsUploading(true)
      setUploadResult(null)

      const response = await fetch('/api/admin/eshipper-upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        // Handle non-JSON error responses (e.g. Vercel "Request Entity Too Large")
        let errorMsg: string
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const errorData = await response.json()
          errorMsg = errorData.error || `Upload failed (${response.status})`
        } else {
          const text = await response.text()
          errorMsg = response.status === 413
            ? 'File too large. Please split into smaller files.'
            : text || `Upload failed (${response.status})`
        }
        setUploadResult({ success: false, message: errorMsg })
        return
      }

      const data = await response.json()

      if (data.success) {
        setUploadResult({
          success: true,
          message: `Imported ${data.rowsProcessed} shipments from ${file.name}`,
          details: data.byCompany,
        })
        // Refresh stats
        fetchData()
      } else {
        setUploadResult({
          success: false,
          message: data.error || 'Upload failed',
        })
      }
    } catch (err) {
      setUploadResult({
        success: false,
        message: err instanceof Error ? err.message : 'Upload failed',
      })
    } finally {
      setIsUploading(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  if (isLoading) return null

  return (
    <div className="space-y-6">
      {/* Commission Assignments Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Commission Assignments
            </CardTitle>
            <CardDescription>
              Users with commission structures and their assigned brands
            </CardDescription>
          </div>
          <Button onClick={() => setIsDialogOpen(true)} size="sm">
            <UserPlus className="h-4 w-4 mr-2" />
            Add Assignment
          </Button>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No commission assignments yet. Click &quot;Add Assignment&quot; to create one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Commission Type</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Assigned Brands</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell>
                      {(() => {
                        const user = parentUsers.find(u => u.id === assignment.user_id)
                        return user ? (
                          <div className="flex flex-col">
                            <span className="font-medium">{user.full_name || user.email}</span>
                            {user.role && (
                              <span className="text-xs text-muted-foreground">{user.role}</span>
                            )}
                          </div>
                        ) : (
                          <code className="text-xs bg-muted px-1 py-0.5 rounded">
                            {assignment.user_id.slice(0, 8)}...
                          </code>
                        )
                      })()}
                    </TableCell>
                    <TableCell>{assignment.commission_type_name}</TableCell>
                    <TableCell>{assignment.start_date}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {assignment.clients.length === 0 ? (
                          <span className="text-muted-foreground text-sm">None</span>
                        ) : (
                          assignment.clients.map((c) => (
                            <Badge key={c.client_id} variant="secondary" className="text-xs">
                              {c.client_name}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={assignment.is_active ? 'default' : 'secondary'}>
                        {assignment.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteAssignment(assignment.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* eShipper Data Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            eShipper Shipment Data
          </CardTitle>
          <CardDescription>
            Upload eShipper export files (CSV or Excel) to import shipment data for commission calculations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Upload Section */}
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={handleFileUpload}
              className="hidden"
              id="eshipper-upload"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <JetpackLoader size="sm" className="mr-2" />
                  Uploading...
                </>
              ) : (
                <>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Upload eShipper Export
                </>
              )}
            </Button>
            <span className="text-sm text-muted-foreground">
              Supports .csv, .xls, .xlsx files
            </span>
          </div>

          {/* Upload Result */}
          {uploadResult && (
            <div
              className={cn(
                'p-3 rounded-md text-sm',
                uploadResult.success
                  ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                  : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
              )}
            >
              <div className="flex items-center gap-2">
                {uploadResult.success ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {uploadResult.message}
              </div>
              {uploadResult.details && (
                <div className="mt-2 text-xs">
                  {Object.entries(uploadResult.details).map(([company, count]) => (
                    <div key={company}>
                      {company}: {count} shipments
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Monthly Breakdowns */}
          {eshipperStats && eshipperStats.by_month && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Monthly Shipments</h4>
                <Badge variant="outline">
                  {eshipperStats.total_shipments.toLocaleString()} total
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Data range: {eshipperStats.date_range.earliest} to {eshipperStats.date_range.latest}
              </p>

              <div className="grid gap-3">
                {eshipperStats.by_month.map((monthData) => (
                  <div
                    key={`${monthData.year}-${monthData.monthNum}`}
                    className="border rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">
                        {monthData.month} {monthData.year}
                      </span>
                      <Badge variant="secondary">
                        {monthData.total.toLocaleString()} shipments
                      </Badge>
                    </div>
                    {monthData.byClient.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {monthData.byClient.map((item) => (
                          <div
                            key={item.client_name}
                            className="text-sm bg-muted/50 rounded px-2 py-1"
                          >
                            <span className="font-medium">{item.client_name}</span>
                            <span className="text-muted-foreground ml-1">
                              ({item.shipments.toLocaleString()})
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No shipments this month</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!eshipperStats && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No eShipper data imported yet. Upload an export file to get started.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Create Assignment Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Commission Assignment</DialogTitle>
            <DialogDescription>
              Assign a user to a commission type and select which brands count toward their commission.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {dialogError && (
              <div className="p-3 rounded-md bg-red-50 text-red-800 text-sm dark:bg-red-950 dark:text-red-200">
                {dialogError}
              </div>
            )}

            {/* User Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">User</label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {parentUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name || user.email}
                      {user.role && (
                        <span className="text-muted-foreground ml-1">
                          ({user.role})
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {parentUsers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No parent-level users found
                </p>
              )}
            </div>

            {/* Commission Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Commission Type</label>
              <Select value={selectedCommissionTypeId} onValueChange={setSelectedCommissionTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select commission type" />
                </SelectTrigger>
                <SelectContent>
                  {commissionTypes.map((ct) => (
                    <SelectItem key={ct.id} value={ct.id}>
                      {ct.name} (${ct.formula_params.C} × n^{ct.formula_params.K})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Start Date */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm bg-background"
              />
            </div>

            {/* Client Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Assigned Brands</label>
                {clients.filter(c => c.eshipper_id || c.merchant_id).length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => {
                      const eligibleClients = clients.filter(c => c.eshipper_id || c.merchant_id)
                      const allSelected = eligibleClients.every(c => selectedClientIds.includes(c.id))
                      if (allSelected) {
                        setSelectedClientIds([])
                      } else {
                        setSelectedClientIds(eligibleClients.map(c => c.id))
                      }
                    }}
                  >
                    {clients.filter(c => c.eshipper_id || c.merchant_id).every(c => selectedClientIds.includes(c.id))
                      ? 'Deselect All'
                      : 'Select All'}
                  </Button>
                )}
              </div>
              <div className="border rounded-md max-h-48 overflow-y-auto">
                {clients.filter(c => c.eshipper_id || c.merchant_id).length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    No brands with partner IDs configured
                  </p>
                ) : (
                  clients
                    .filter(c => c.eshipper_id || c.merchant_id)
                    .map((client) => (
                      <div
                        key={client.id}
                        className="flex items-center gap-2 p-2 hover:bg-muted/50 cursor-pointer"
                        onClick={() => toggleClient(client.id)}
                      >
                        <Checkbox
                          checked={selectedClientIds.includes(client.id)}
                          onCheckedChange={() => toggleClient(client.id)}
                        />
                        <span className="text-sm">{client.company_name}</span>
                        <div className="ml-auto flex gap-1">
                          {client.merchant_id && (
                            <Badge variant="outline" className="text-xs">ShipBob</Badge>
                          )}
                          {client.eshipper_id && (
                            <Badge variant="outline" className="text-xs">eShipper</Badge>
                          )}
                        </div>
                      </div>
                    ))
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedClientIds.length} brand(s) selected
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateAssignment} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <JetpackLoader size="sm" className="mr-2" />
                  Creating...
                </>
              ) : (
                'Create Assignment'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
