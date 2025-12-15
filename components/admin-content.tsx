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
  Loader2,
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
} from 'lucide-react'
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
  short_code?: string | null
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
  generated_at: string
  approved_at: string | null
  version: number
  client?: Client
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
  const { clients } = useClient()

  // Tab state with URL persistence - using Next.js hooks
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const validTabs = ['markup', 'invoicing', 'sync-health']
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
    <div className="p-4 lg:p-6">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList>
          <TabsTrigger value="markup">Markups</TabsTrigger>
          <TabsTrigger value="invoicing">Invoicing</TabsTrigger>
          <TabsTrigger value="sync-health">Sync Health</TabsTrigger>
        </TabsList>

        {/* Markup Tables Tab */}
        <TabsContent value="markup" className="space-y-6">
          <MarkupTablesContent clients={clients} />
        </TabsContent>

        {/* Run Invoicing Tab */}
        <TabsContent value="invoicing" className="space-y-6">
          <InvoicingContent clients={clients} />
        </TabsContent>

        {/* Sync Health Tab */}
        <TabsContent value="sync-health" className="space-y-6">
          <SyncHealthContent />
        </TabsContent>
      </Tabs>
    </div>
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

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
          <div className="space-y-2">
            <Label htmlFor="client">Client</Label>
            <Select
              value={formData.client_id || 'global'}
              onValueChange={v =>
                setFormData({ ...formData, client_id: v === 'global' ? null : v })
              }
            >
              <SelectTrigger>
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
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
    additionalServiceTransactions: number
    storageTransactions: number
    returnsTransactions: number
    receivingTransactions: number
    creditsTransactions: number
  }
}

interface PreflightResult {
  success: boolean
  shipbobInvoiceCount: number
  clients: PreflightClientResult[]
  summary: {
    totalClients: number
    passed: number
    warnings: number
    failed: number
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
  const [selectedInvoiceId, setSelectedInvoiceId] = React.useState<string | null>(null)
  const [isRegenerating, setIsRegenerating] = React.useState<string | null>(null)
  const [isRegeneratingAll, setIsRegeneratingAll] = React.useState(false)
  const [isApproving, setIsApproving] = React.useState<string | null>(null)

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

  async function handleDownloadFile(invoiceId: string, fileType: 'pdf' | 'xlsx') {
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
      console.error('Error downloading file:', err)
      setError(err instanceof Error ? err.message : 'Failed to download file')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

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
                <Loader2 className="h-4 w-4 animate-spin" />
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
                        {isLoadingPreflight && <Loader2 className="h-4 w-4 animate-spin" />}
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
                    {preflightResult.clients.map(client => (
                      <div key={client.clientId} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {client.passed ? (
                              client.warnings.length > 0 ? (
                                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                              ) : (
                                <CheckCircle2 className="h-5 w-5 text-green-500" />
                              )
                            ) : (
                              <XCircle className="h-5 w-5 text-destructive" />
                            )}
                            <span className="font-medium">{client.clientName}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {client.summary.shippingTransactions} shipments, {' '}
                            {client.summary.additionalServiceTransactions} addl services, {' '}
                            {client.summary.storageTransactions} storage, {' '}
                            {client.summary.returnsTransactions} returns, {' '}
                            {client.summary.receivingTransactions} receiving, {' '}
                            {client.summary.creditsTransactions} credits
                          </div>
                        </div>

                        {client.issues.length > 0 && (
                          <div className="space-y-1 mt-2">
                            {client.issues.map((issue, idx) => (
                              <div key={idx} className="text-sm text-destructive flex items-start gap-2">
                                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                <span>{issue.message}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {client.warnings.length > 0 && (
                          <div className="space-y-1 mt-2">
                            {client.warnings.map((warning, idx) => (
                              <div key={idx} className="text-sm text-yellow-600 flex items-start gap-2">
                                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                <span>{warning.message}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
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
                      <Loader2 className="h-4 w-4 animate-spin" />
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
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="text-right">Markup</TableHead>
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
                        <TableCell className="font-mono font-medium">
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
                                <DropdownMenuItem onClick={() => handleDownloadFile(invoice.id, 'pdf')}>
                                  <FileText className="h-4 w-4 mr-2" />
                                  View PDF
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDownloadFile(invoice.id, 'xlsx')}>
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
                                    <Loader2 className="h-4 w-4 animate-spin" />
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
                                    <Loader2 className="h-4 w-4 animate-spin" />
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedInvoices.map(invoice => {
                    const client = clients.find(c => c.id === invoice.client_id)
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono font-medium">
                          {invoice.invoice_number}
                          {invoice.version > 1 && (
                            <Badge variant="outline" className="ml-2 text-xs">v{invoice.version}</Badge>
                          )}
                        </TableCell>
                        <TableCell>{client?.company_name || 'Unknown'}</TableCell>
                        <TableCell>
                          {formatDateFixed(invoice.invoice_date)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ${invoice.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={invoice.status === 'sent' ? 'default' : 'secondary'}
                          >
                            {invoice.status === 'sent' ? 'Sent' : 'Approved'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <Download className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleDownloadFile(invoice.id, 'pdf')}>
                                <FileText className="h-4 w-4 mr-2" />
                                Download PDF
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDownloadFile(invoice.id, 'xlsx')}>
                                <FileSpreadsheet className="h-4 w-4 mr-2" />
                                Download XLSX
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
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

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
