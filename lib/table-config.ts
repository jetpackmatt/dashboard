// Responsive Table Column Configuration System
// This provides a unified way to define table columns with responsive priority

export interface ColumnConfig {
  id: string
  header: string
  width: number        // Base width percentage (before redistribution)
  priority: number     // 1 = highest (always visible), higher = hides first
  defaultVisible?: boolean  // Whether column is visible by default (default: true)
  align?: 'left' | 'center' | 'right'  // Text alignment (default: left)
  dividerAfter?: boolean  // Show vertical divider after this column
  extraPaddingLeft?: boolean  // Add extra padding on the left (useful after dividers)
  maxWidth?: number    // Max width in px (auto layout will truncate with ellipsis beyond this)
  sortable?: boolean   // Whether this column supports sorting
  sortKey?: string     // Database column name for sorting (defaults to id)
  shrinkToFit?: boolean // Column takes minimum content width (w-px whitespace-nowrap)
  tinted?: boolean      // Light grey background tint on th/td for visual grouping
}

export interface TableConfig {
  columns: ColumnConfig[]
  // Breakpoints define max priority visible at each screen size
  // Columns with priority > threshold are hidden
  breakpoints: {
    xl: number   // 1280px+ (e.g., 10 = show all)
    lg: number   // 1024px
    md: number   // 768px
    sm: number   // 640px
    xs: number   // <640px
  }
}

// ============================================
// UNFULFILLED ORDERS TABLE CONFIG
// ============================================
// IMPORTANT: Column order here = display order. Priority only affects which hides first.
export const UNFULFILLED_TABLE_CONFIG: TableConfig = {
  columns: [
    // Display order matches original table layout
    { id: 'orderDate',    header: 'Order Imported',  width: 15, priority: 3, sortable: true, sortKey: 'created_at', tinted: true },
    { id: 'shipmentId',   header: 'Shipment ID', width: 11, priority: 11, tinted: true },
    { id: 'status',       header: 'Status',      width: 12, priority: 2, tinted: true },
    { id: 'orderId',      header: 'Order ID',    width: 9,  priority: 1, defaultVisible: false },
    { id: 'customerName', header: 'Customer',    width: 11, priority: 4, extraPaddingLeft: true },
    { id: 'channelName',  header: 'Channel',     width: 6,  priority: 10, align: 'center' },
    { id: 'storeOrderId', header: 'Store ID',    width: 8,  priority: 9, align: 'center', maxWidth: 130 },
    { id: 'itemCount',    header: 'Picks',       width: 6,  priority: 6, align: 'center' },
    { id: 'orderType',    header: 'Type',        width: 6,  priority: 8, align: 'center' },
    { id: 'age',          header: 'Age',         width: 4,  priority: 5, align: 'center' },
    { id: 'slaDate',      header: 'SLA Date',    width: 12, priority: 7 },
    // Optional columns (not visible by default) - priority 12+
    { id: 'totalShipments', header: '# Shipments', width: 6,  priority: 12, defaultVisible: false },
    { id: 'destCountry',    header: 'Dest. Country', width: 8,  priority: 13, defaultVisible: false },
    { id: 'shipOption',     header: 'Ship Option',   width: 12, priority: 14, defaultVisible: false },
  ],
  breakpoints: {
    xl: 11,  // 1280px+: All 11 columns (including Shipment ID)
    lg: 8,   // 1024px: Hide Channel, Store ID, Shipment ID
    md: 6,   // 768px: Also hide Type, SLA Date
    sm: 4,   // 640px: Also hide Picks, Age
    xs: 3,   // <640px: Just Order ID, Status, Order Date
  }
}

// ============================================
// SHIPMENTS TABLE CONFIG
// ============================================
// IMPORTANT: Column order here = display order. Priority only affects which hides first.
export const SHIPMENTS_TABLE_CONFIG: TableConfig = {
  columns: [
    // Default visible columns (display order)
    { id: 'labelCreated', header: 'Label Created', width: 12, priority: 10, sortable: true, sortKey: 'event_labeled', tinted: true },
    { id: 'shipmentId',   header: 'Shipment ID',   width: 10, priority: 12, tinted: true },
    { id: 'status',       header: 'Status',        width: 12, priority: 2, tinted: true },
    { id: 'orderId',      header: 'Order ID',      width: 10, priority: 1, defaultVisible: false },
    { id: 'customerName', header: 'Customer',      width: 11, priority: 5, sortable: true, sortKey: 'recipient_name', extraPaddingLeft: true },
    { id: 'carrier',      header: 'Carrier',       width: 9,  priority: 9, sortable: true, sortKey: 'carrier' },
    { id: 'trackingId',   header: 'Tracking ID',   width: 10, priority: 3, maxWidth: 160, defaultVisible: false },
    { id: 'charge',       header: 'Charge',        width: 6,  priority: 4, align: 'center', shrinkToFit: true },
    { id: 'qty',          header: 'Qty',           width: 5,  priority: 8, align: 'center', shrinkToFit: true },
    { id: 'transitTimeDays', header: 'Transit',    width: 6,  priority: 7, align: 'center', sortable: true, sortKey: 'transit_time_days', shrinkToFit: true },
    { id: 'age',          header: 'Age',           width: 5,  priority: 11, align: 'center', sortable: true, sortKey: 'event_labeled', shrinkToFit: true },
    { id: 'actions',      header: '',              width: 10, priority: 1, shrinkToFit: true, tinted: true },
    // Optional columns (not visible by default) - priority 13+
    { id: 'orderType',    header: 'Type',          width: 6,  priority: 13, defaultVisible: false },
    { id: 'channelName',  header: 'Channel',       width: 5,  priority: 14, defaultVisible: false },
    { id: 'destCountry',  header: 'Dest. Country', width: 8,  priority: 15, defaultVisible: false },
    { id: 'orderDate',    header: 'Order Date',    width: 12, priority: 16, defaultVisible: false },
    { id: 'fcName',       header: 'FC',            width: 10, priority: 17, defaultVisible: false },
    { id: 'shipOption',   header: 'Ship Option',   width: 12, priority: 18, defaultVisible: false },
    { id: 'deliveredDate', header: 'Delivered On',  width: 12, priority: 19, defaultVisible: false },
    { id: 'storeOrderId', header: 'Store Order',   width: 10, priority: 20, maxWidth: 130, defaultVisible: false },
  ],
  breakpoints: {
    xl: 20,  // 1280px+: All columns (up to priority 20)
    lg: 12,  // 1024px: Default columns only (11 columns including Age and Shipment ID)
    md: 6,   // 768px: Hide Transit, Items, Carrier, Age
    sm: 4,   // 640px: Also hide Customer, Cost
    xs: 3,   // <640px: Just Order ID, Status, Tracking
  }
}

// ============================================
// ADDITIONAL SERVICES TABLE CONFIG (transactions table - shipment fees)
// XLS columns: Reference ID, Fee Type, Invoice Amount, Transaction Date, Invoice Number, Invoice Date, Transaction Status
// ============================================
export const ADDITIONAL_SERVICES_TABLE_CONFIG: TableConfig = {
  columns: [
    { id: 'transactionDate', header: 'Date', width: 15, priority: 1, sortable: true, sortKey: 'charge_date' },
    { id: 'referenceId',     header: 'Reference ID',     width: 14, priority: 3 },
    { id: 'status',          header: 'Status',           width: 14, priority: 6 },
    { id: 'feeType',         header: 'Fee Type',         width: 18, priority: 4 },
    { id: 'charge',          header: 'Charge',           width: 13, priority: 5 },
    { id: 'invoiceNumber',   header: 'Invoice',          width: 14, priority: 2 },
  ],
  breakpoints: {
    xl: 6,
    lg: 5,
    md: 4,
    sm: 3,
    xs: 3,
  }
}

// ============================================
// RETURNS TABLE CONFIG (transactions table - returns)
// XLS columns: Return ID, Original Order ID, Tracking ID, Transaction Type, Return Status, Return Type, Return Creation Date, FC Name, Amount, Invoice Number, Invoice Date, Status
// ============================================
export const RETURNS_TABLE_CONFIG: TableConfig = {
  columns: [
    { id: 'returnCreationDate', header: 'Created',           width: 10, priority: 1, sortable: true, sortKey: 'charge_date' },
    { id: 'invoiceNumber',      header: 'Invoice',           width: 14, priority: 2 },
    { id: 'returnId',           header: 'Return ID',         width: 8, priority: 3 },
    { id: 'returnStatus',       header: 'Return Status',     width: 10, priority: 4 },
    { id: 'returnType',         header: 'Return Type',       width: 15, priority: 5 },
    { id: 'charge',             header: 'Charge',            width: 7, priority: 6 },
    { id: 'originalShipmentId', header: 'Original Shipment', width: 10, priority: 7 },
    { id: 'trackingNumber',     header: 'Tracking #',        width: 18, priority: 8, maxWidth: 160 },
    { id: 'fcName',             header: 'FC',                width: 11, priority: 9, defaultVisible: false },
  ],
  breakpoints: {
    xl: 8,
    lg: 6,
    md: 5,
    sm: 4,
    xs: 3,
  }
}

// ============================================
// RECEIVING TABLE CONFIG (transactions table - receiving)
// Joined with receiving_orders table for status and contents
// ============================================
export const RECEIVING_TABLE_CONFIG: TableConfig = {
  columns: [
    { id: 'transactionDate',  header: 'Date',             width: 11, priority: 1, sortable: true, sortKey: 'charge_date' },
    { id: 'wroId',            header: 'WRO ID',           width: 8,  priority: 2 },
    { id: 'feeType',          header: 'Fee Type',         width: 12, priority: 3 },
    { id: 'invoiceNumber',    header: 'Invoice',          width: 14, priority: 4 },
    { id: 'charge',           header: 'Charge',           width: 9,  priority: 5 },
    { id: 'receivingStatus',  header: 'Status',           width: 12, priority: 6 },
    { id: 'contents',         header: 'Contents',         width: 31, priority: 7 },
  ],
  breakpoints: {
    xl: 7,
    lg: 5,
    md: 4,
    sm: 3,
    xs: 3,
  }
}

// ============================================
// STORAGE TABLE CONFIG (transactions table - storage)
// XLS columns: ChargeStartdate, FC Name, Inventory ID, Location Type, Comment, Transaction Status, Invoice Number, Amount, Invoice Date
// Note: No date range filter for storage
// ============================================
export const STORAGE_TABLE_CONFIG: TableConfig = {
  columns: [
    { id: 'chargeStartDate', header: 'Date',   width: 12, priority: 1, sortable: true, sortKey: 'charge_date' },
    { id: 'invoiceNumber',   header: 'Invoice',        width: 16, priority: 2 },
    { id: 'inventoryId',     header: 'Inventory ID',   width: 10, priority: 3 },
    { id: 'fcName',          header: 'FC Name',        width: 14, priority: 4 },
    { id: 'locationType',    header: 'Location Type',  width: 12, priority: 5 },
    { id: 'charge',          header: 'Charge',         width: 10, priority: 6 },
    { id: 'status',          header: 'Status',         width: 12, priority: 7 },
    { id: 'comment',         header: 'Comment',        width: 12, priority: 8, defaultVisible: false },
  ],
  breakpoints: {
    xl: 7,
    lg: 6,
    md: 5,
    sm: 4,
    xs: 3,
  }
}

// ============================================
// CREDITS TABLE CONFIG (transactions table - credits)
// XLS columns: Reference ID, Transaction Date, Credit Invoice Number, Invoice Date, Credit Reason, Credit Amount, Transaction Status
// ============================================
export const CREDITS_TABLE_CONFIG: TableConfig = {
  columns: [
    { id: 'transactionDate',     header: 'Date', width: 11, priority: 1, sortable: true, sortKey: 'charge_date' },
    { id: 'creditInvoiceNumber', header: 'Invoice',          width: 14, priority: 2 },
    { id: 'status',              header: 'Status',           width: 12, priority: 3 },
    { id: 'referenceId',         header: 'Reference ID',     width: 12, priority: 4 },
    { id: 'sbTicketReference',   header: 'ShipBob Ticket',   width: 12, priority: 5 },
    { id: 'creditAmount',        header: 'Credit',           width: 8, priority: 6 },
    { id: 'creditReason',        header: 'Credit Reason',    width: 23, priority: 7 },
  ],
  breakpoints: {
    xl: 7,
    lg: 5,
    md: 4,
    sm: 3,
    xs: 3,
  }
}

// ============================================
// SHIPPED ORDERS TABLE CONFIG
// ============================================
export const SHIPPED_TABLE_CONFIG: TableConfig = {
  columns: [
    { id: 'orderId',       header: 'Order ID',     width: 8,  priority: 1 },
    { id: 'storeOrderId',  header: 'Store Order',  width: 12, priority: 9, maxWidth: 130 },
    { id: 'customerName',  header: 'Customer',     width: 13, priority: 4, maxWidth: 160 },
    { id: 'status',        header: 'Status',       width: 11, priority: 2 },
    { id: 'carrier',       header: 'Carrier',      width: 12, priority: 5 },
    { id: 'trackingId',    header: 'Tracking',     width: 12, priority: 6, maxWidth: 160 },
    { id: 'shippedDate',   header: 'Shipped',      width: 11, priority: 3, sortable: true, sortKey: 'shipped_date' },
    { id: 'deliveredDate', header: 'Delivered',    width: 11, priority: 7 },
    { id: 'itemCount',     header: 'Items',        width: 6,  priority: 8 },
    { id: 'charge',        header: 'Charge',       width: 8,  priority: 10 },
  ],
  breakpoints: {
    xl: 10,
    lg: 8,
    md: 6,
    sm: 4,
    xs: 3,
  }
}

// ============================================
// INVOICES TABLE CONFIG
// ============================================
// All columns left-aligned for consistent visual rhythm (no left-vs-right spacing gap).
// Shipments before Cost since it's a count, not a dollar figure.
export const INVOICES_TABLE_CONFIG: TableConfig = {
  columns: [
    { id: 'client',        header: '',              width: 3,  priority: 1 },
    { id: 'invoiceDate',   header: 'Date',          width: 7,  priority: 1, sortable: true, sortKey: 'invoice_date' },
    { id: 'invoiceNumber', header: 'Invoice #',     width: 7,  priority: 1 },
    { id: 'billingPeriod', header: 'Period',         width: 8,  priority: 1 },
    { id: 'shipments',     header: 'Orders',          width: 5,  priority: 2, sortable: true, sortKey: 'shipment_count' },
    { id: 'cost',          header: 'Cost',           width: 6,  priority: 2, sortable: true, sortKey: 'subtotal' },
    { id: 'profit',        header: 'Profit',         width: 6,  priority: 2, sortable: true, sortKey: 'total_markup' },
    { id: 'transactions',  header: 'Transactions',   width: 5,  priority: 3 },
    { id: 'amount',        header: 'Total',          width: 7,  priority: 1, sortable: true, sortKey: 'total_amount' },
    { id: 'status',        header: 'Status',         width: 5,  priority: 1 },
    { id: 'download',      header: '',               width: 3,  priority: 1, align: 'center' },
  ],
  breakpoints: {
    xl: 2,
    lg: 2,
    md: 1,
    sm: 1,
    xs: 1,
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get the current breakpoint based on window width
 */
export function getCurrentBreakpoint(width: number): keyof TableConfig['breakpoints'] {
  if (width >= 1280) return 'xl'
  if (width >= 1024) return 'lg'
  if (width >= 768) return 'md'
  if (width >= 640) return 'sm'
  return 'xs'
}

/**
 * Get visible columns based on priority threshold and user selections
 */
export function getVisibleColumns(
  config: TableConfig,
  maxPriority: number,
  userEnabledColumns?: Set<string>
): ColumnConfig[] {
  return config.columns.filter(col => {
    // If user explicitly enabled this column, check if it fits priority
    if (userEnabledColumns?.has(col.id)) {
      return col.priority <= maxPriority
    }
    // Default visible columns show if within priority
    if (col.defaultVisible !== false) {
      return col.priority <= maxPriority
    }
    return false
  })
}

// ============================================
// CARE TICKETS TABLE CONFIG
// ============================================
export const CARE_TABLE_CONFIG: TableConfig = {
  columns: [
    { id: 'client',       header: '',             width: 8,  priority: 1, align: 'left' },   // Client badge (admin only)
    { id: 'partner',      header: '',             width: 4,  priority: 1, align: 'left' },   // Partner icon (admin only)
    { id: 'dateCreated',  header: 'Date',         width: 8,  priority: 1, sortable: true },
    { id: 'reference',    header: 'Reference ID', width: 12, priority: 2 },
    { id: 'lastUpdated',  header: 'Age',          width: 7,  priority: 3, sortable: true },
    { id: 'type',         header: 'Type',         width: 14, priority: 4 },
    { id: 'status',       header: 'Status',       width: 15, priority: 1 },
    { id: 'credit',       header: 'Credit',       width: 9,  priority: 5, align: 'left', sortable: true },
    { id: 'latestNotes',  header: 'Description',  width: 50, priority: 6 },  // Gets ~40% at base, absorbs expansion
  ],
  breakpoints: {
    xl: 6,  // Show all
    lg: 6,  // Show all
    md: 5,  // Hide credit
    sm: 4,  // Also hide type
    xs: 3,  // Also hide lastUpdated
  }
}

/**
 * Calculate redistributed widths for visible columns
 * Ensures widths always total 100%
 */
export function getRedistributedWidths(
  visibleColumns: ColumnConfig[]
): Record<string, number> {
  const totalBaseWidth = visibleColumns.reduce((sum, col) => sum + col.width, 0)
  const widths: Record<string, number> = {}

  visibleColumns.forEach(col => {
    // Redistribute proportionally to maintain ratios
    widths[col.id] = (col.width / totalBaseWidth) * 100
  })

  return widths
}

/**
 * Get column IDs in display order (as defined in config)
 * Note: Priority only affects which columns hide first, not display order
 */
export function getColumnIds(config: TableConfig): string[] {
  return config.columns.map(col => col.id)
}

/**
 * Create a width lookup map for a given set of visible columns
 */
export function createWidthMap(
  config: TableConfig,
  visibleColumnIds: string[]
): Record<string, string> {
  const visibleConfigs = config.columns.filter(c => visibleColumnIds.includes(c.id))
  const redistributed = getRedistributedWidths(visibleConfigs)

  const widthMap: Record<string, string> = {}
  for (const [id, width] of Object.entries(redistributed)) {
    widthMap[id] = `${width}%`
  }
  return widthMap
}
