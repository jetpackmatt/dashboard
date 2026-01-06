// Responsive Table Column Configuration System
// This provides a unified way to define table columns with responsive priority

export interface ColumnConfig {
  id: string
  header: string
  width: number        // Base width percentage (before redistribution)
  priority: number     // 1 = highest (always visible), higher = hides first
  defaultVisible?: boolean  // Whether column is visible by default (default: true)
  align?: 'left' | 'center' | 'right'  // Text alignment (default: left)
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
    { id: 'orderId',      header: 'Order ID',    width: 9,  priority: 1 },
    { id: 'shipmentId',   header: 'Shipment ID', width: 11, priority: 11 },
    { id: 'status',       header: 'Status',      width: 12, priority: 2 },
    { id: 'customerName', header: 'Customer',    width: 11, priority: 4 },
    { id: 'channelName',  header: 'Channel',     width: 6,  priority: 10, align: 'center' },
    { id: 'storeOrderId', header: 'Store ID',    width: 8,  priority: 9, align: 'center' },
    { id: 'itemCount',    header: 'Picks',       width: 6,  priority: 6, align: 'center' },
    { id: 'orderType',    header: 'Type',        width: 6,  priority: 8, align: 'center' },
    { id: 'age',          header: 'Age',         width: 4,  priority: 5, align: 'center' },
    { id: 'orderDate',    header: 'Order Imported',  width: 15, priority: 3 },
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
    { id: 'orderId',      header: 'Order ID',      width: 9,  priority: 1 },
    { id: 'shipmentId',   header: 'Shipment ID',   width: 11, priority: 12 },
    { id: 'status',       header: 'Status',        width: 12, priority: 2 },
    { id: 'customerName', header: 'Customer',      width: 11, priority: 5 },
    { id: 'charge',       header: 'Charge',        width: 7,  priority: 4, align: 'center' },
    { id: 'qty',          header: 'Items',         width: 5,  priority: 8, align: 'center' },
    { id: 'carrier',      header: 'Carrier',       width: 9,  priority: 9 },
    { id: 'trackingId',   header: 'Tracking ID',   width: 10, priority: 3 },
    { id: 'transitTimeDays', header: 'Transit',    width: 6,  priority: 7, align: 'center' },
    { id: 'age',          header: 'Age',           width: 5,  priority: 11, align: 'center' },
    { id: 'labelCreated', header: 'Label Created', width: 15, priority: 10 },
    // Optional columns (not visible by default) - priority 13+
    { id: 'orderType',    header: 'Type',          width: 6,  priority: 13, defaultVisible: false },
    { id: 'channelName',  header: 'Channel',       width: 5,  priority: 14, defaultVisible: false },
    { id: 'destCountry',  header: 'Dest. Country', width: 8,  priority: 15, defaultVisible: false },
    { id: 'orderDate',    header: 'Order Date',    width: 12, priority: 16, defaultVisible: false },
    { id: 'fcName',       header: 'FC',            width: 10, priority: 17, defaultVisible: false },
    { id: 'shipOption',   header: 'Ship Option',   width: 12, priority: 18, defaultVisible: false },
    { id: 'deliveredDate', header: 'Delivered On',  width: 12, priority: 19, defaultVisible: false },
    { id: 'storeOrderId', header: 'Store Order',   width: 10, priority: 20, defaultVisible: false },
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
    { id: 'transactionDate', header: 'Transaction Date', width: 15, priority: 1 },
    { id: 'referenceId',     header: 'Reference ID',     width: 14, priority: 2 },
    { id: 'feeType',         header: 'Fee Type',         width: 16, priority: 3 },
    { id: 'charge',          header: 'Charge',           width: 13, priority: 5, align: 'center' },
    { id: 'status',          header: 'Status',           width: 14, priority: 4, align: 'center' },
    { id: 'invoiceNumber',   header: 'Invoice #',        width: 14, priority: 6, align: 'center' },
    { id: 'invoiceDate',     header: 'Invoice Date',     width: 14, priority: 7, align: 'center' },
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
// RETURNS TABLE CONFIG (transactions table - returns)
// XLS columns: Return ID, Original Order ID, Tracking ID, Transaction Type, Return Status, Return Type, Return Creation Date, FC Name, Amount, Invoice Number, Invoice Date, Status
// ============================================
export const RETURNS_TABLE_CONFIG: TableConfig = {
  columns: [
    { id: 'returnCreationDate', header: 'Created',           width: 10, priority: 1 },
    { id: 'returnId',           header: 'Return ID',         width: 8, priority: 2 },
    { id: 'returnStatus',       header: 'Return Status',     width: 10, priority: 3 },
    { id: 'returnType',         header: 'Return Type',       width: 12, priority: 4 },
    { id: 'charge',             header: 'Charge',            width: 7, priority: 5 },
    { id: 'originalShipmentId', header: 'Original Shipment', width: 12, priority: 6 },
    { id: 'trackingNumber',     header: 'Tracking #',        width: 12, priority: 7 },
    { id: 'fcName',             header: 'FC',                width: 11, priority: 8, defaultVisible: false },
    { id: 'invoiceNumber',      header: 'Invoice #',         width: 10, priority: 9 },
    { id: 'invoiceDate',        header: 'Invoice Date',      width: 9, priority: 10 },
  ],
  breakpoints: {
    xl: 10,
    lg: 7,
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
    { id: 'transactionDate',  header: 'Transaction Date', width: 14, priority: 1 },
    { id: 'wroId',            header: 'WRO ID',           width: 10, priority: 2 },
    { id: 'receivingStatus',  header: 'Status',           width: 12, priority: 3 },
    { id: 'contents',         header: 'Contents',         width: 14, priority: 4 },
    { id: 'feeType',          header: 'Fee Type',         width: 16, priority: 5 },
    { id: 'charge',           header: 'Charge',           width: 10, priority: 6 },
    { id: 'invoiceNumber',    header: 'Invoice #',        width: 12, priority: 7 },
    { id: 'invoiceDate',      header: 'Invoice Date',     width: 12, priority: 8 },
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
// STORAGE TABLE CONFIG (transactions table - storage)
// XLS columns: ChargeStartdate, FC Name, Inventory ID, Location Type, Comment, Transaction Status, Invoice Number, Amount, Invoice Date
// Note: No date range filter for storage
// ============================================
export const STORAGE_TABLE_CONFIG: TableConfig = {
  columns: [
    { id: 'inventoryId',     header: 'Inventory ID',   width: 12, priority: 1 },
    { id: 'fcName',          header: 'FC Name',        width: 14, priority: 2 },
    { id: 'locationType',    header: 'Location Type',  width: 10, priority: 3 },
    { id: 'chargeStartDate', header: 'Charge Start',   width: 12, priority: 5 },
    { id: 'charge',          header: 'Charge',         width: 10, priority: 4 },
    { id: 'status',          header: 'Status',         width: 10, priority: 6 },
    { id: 'invoiceNumber',   header: 'Invoice #',      width: 10, priority: 7 },
    { id: 'invoiceDate',     header: 'Invoice Date',   width: 12, priority: 8 },
    { id: 'comment',         header: 'Comment',        width: 10, priority: 9, defaultVisible: false },
  ],
  breakpoints: {
    xl: 9,
    lg: 7,
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
    { id: 'referenceId',         header: 'Reference ID',     width: 12, priority: 1 },
    { id: 'sbTicketReference',   header: 'ShipBob Ticket',   width: 12, priority: 2 },
    { id: 'creditAmount',        header: 'Credit',           width: 10, priority: 3 },
    { id: 'creditReason',        header: 'Credit Reason',    width: 18, priority: 4 },
    { id: 'transactionDate',     header: 'Transaction Date', width: 14, priority: 5 },
    { id: 'status',              header: 'Status',           width: 10, priority: 6 },
    { id: 'creditInvoiceNumber', header: 'Credit Invoice #', width: 12, priority: 7 },
    { id: 'invoiceDate',         header: 'Invoice Date',     width: 12, priority: 8 },
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
// SHIPPED ORDERS TABLE CONFIG
// ============================================
export const SHIPPED_TABLE_CONFIG: TableConfig = {
  columns: [
    { id: 'orderId',       header: 'Order ID',     width: 8,  priority: 1 },
    { id: 'storeOrderId',  header: 'Store Order',  width: 12, priority: 9 },
    { id: 'customerName',  header: 'Customer',     width: 13, priority: 4 },
    { id: 'status',        header: 'Status',       width: 11, priority: 2 },
    { id: 'carrier',       header: 'Carrier',      width: 12, priority: 5 },
    { id: 'trackingId',    header: 'Tracking',     width: 12, priority: 6 },
    { id: 'shippedDate',   header: 'Shipped',      width: 11, priority: 3 },
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
