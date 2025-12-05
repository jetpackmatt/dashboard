'use client'

import * as React from 'react'
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
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  Eye,
  Download,
  CalendarIcon,
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
  const [activeTab, setActiveTab] = React.useState('markup')

  return (
    <div className="p-4 lg:p-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="markup" className="gap-2">
            <Percent className="h-4 w-4" />
            Markup Tables
          </TabsTrigger>
          <TabsTrigger value="invoicing" className="gap-2">
            <FileText className="h-4 w-4" />
            Run Invoicing
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
                          {new Date(rule.effective_from).toLocaleDateString()}
                          {rule.effective_to && (
                            <> - {new Date(rule.effective_to).toLocaleDateString()}</>
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

function InvoicingContent({ clients }: { clients: Client[] }) {
  const [invoices, setInvoices] = React.useState<JetpackInvoice[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    fetchInvoices()
  }, [])

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

  async function handleGenerateInvoices() {
    if (!confirm('Generate invoices for this week? This will create draft invoices for all clients.')) {
      return
    }

    setIsGenerating(true)
    try {
      const response = await fetch('/api/admin/invoices/generate', { method: 'POST' })
      if (!response.ok) throw new Error('Failed to generate invoices')
      await fetchInvoices()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invoices')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleApproveInvoice(invoiceId: string) {
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/approve`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to approve invoice')
      await fetchInvoices()
    } catch (err) {
      console.error('Error approving invoice:', err)
    }
  }

  async function handleApproveAll() {
    if (!confirm('Approve all draft invoices? This will finalize and send them to clients.')) {
      return
    }

    const draftInvoices = invoices.filter(i => i.status === 'draft')
    for (const invoice of draftInvoices) {
      await handleApproveInvoice(invoice.id)
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
  const approvedInvoices = invoices.filter(i => i.status === 'approved' || i.status === 'sent')

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Invoice Management</h2>
          <p className="text-sm text-muted-foreground">
            Generate, review, and approve weekly client invoices
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchInvoices} className="gap-2">
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
            </div>
          </CardContent>
        </Card>
      )}

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
              <Button onClick={handleApproveAll} className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Approve All ({draftInvoices.length})
              </Button>
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
                  <TableHead className="w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draftInvoices.map(invoice => {
                  const client = clients.find(c => c.id === invoice.client_id)
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono font-medium">
                        {invoice.invoice_number}
                      </TableCell>
                      <TableCell>{client?.company_name || 'Unknown'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(invoice.period_start).toLocaleDateString()} -{' '}
                        {new Date(invoice.period_end).toLocaleDateString()}
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
                          <Button variant="ghost" size="icon" title="Preview">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Approve"
                            onClick={() => handleApproveInvoice(invoice.id)}
                          >
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          </Button>
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
          <CardTitle>Recent Invoices</CardTitle>
          <CardDescription>Previously approved and sent invoices</CardDescription>
        </CardHeader>
        <CardContent>
          {approvedInvoices.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No approved invoices yet.
            </p>
          ) : (
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
                {approvedInvoices.slice(0, 10).map(invoice => {
                  const client = clients.find(c => c.id === invoice.client_id)
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono font-medium">
                        {invoice.invoice_number}
                      </TableCell>
                      <TableCell>{client?.company_name || 'Unknown'}</TableCell>
                      <TableCell>
                        {new Date(invoice.invoice_date).toLocaleDateString()}
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
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" title="Download PDF">
                            <Download className="h-4 w-4" />
                          </Button>
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
    </>
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
