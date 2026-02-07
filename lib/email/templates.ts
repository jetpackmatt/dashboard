/**
 * Email Templates for Claim Notifications
 *
 * 8 templates based on claim type and reshipment selection:
 * 1. Lost in Transit
 * 2. Damage
 * 3. Incorrect Items - "Please reship for me"
 * 4. Incorrect Items - "I've already reshipped"
 * 5. Incorrect Items - "Don't reship"
 * 6. Short Ship - "Please reship for me"
 * 7. Short Ship - "I've already reshipped"
 * 8. Short Ship - "Don't reship"
 */

export type IssueType = 'Loss' | 'Damage' | 'Pick Error' | 'Short Ship'
export type ReshipmentStatus = 'Please reship for me' | "I've already reshipped" | "Don't reship"

export interface ClaimEmailData {
  merchantName: string      // e.g., "Henson Shaving"
  merchantId: string        // ShipBob merchant ID (e.g., "12345")
  shipmentId: string        // e.g., "340657975"
  issueType: IssueType
  description: string | null
  compensationRequest: string | null  // Only for Pick Error (Incorrect Items)
  reshipmentStatus: ReshipmentStatus | null
  reshipmentId: string | null
}

export interface ClaimEmailResult {
  subject: string
  text: string
  html: string
}

/**
 * Map database issue_type to display name for email
 */
function getIssueTypeDisplayName(issueType: IssueType): string {
  switch (issueType) {
    case 'Loss':
      return 'Lost in Transit'
    case 'Damage':
      return 'Damage'
    case 'Pick Error':
      return 'Incorrect Items'
    case 'Short Ship':
      return 'Short Ship'
    default:
      return issueType
  }
}

/**
 * Generate email content for a claim
 *
 * Subject format: "$merchant_name - $Shipment_id - $Type Claim"
 * Example: "Henson Shaving - 340657975 - Lost in Transit Claim"
 */
export function generateClaimEmail(data: ClaimEmailData): ClaimEmailResult {
  const displayName = getIssueTypeDisplayName(data.issueType)
  const subject = `${data.merchantName} - ${data.shipmentId} - ${displayName} Claim`

  const text = getEmailBody(data)
  // Convert to HTML with proper line breaks and bold headers
  const html = text
    .replace(/\n/g, '<br>\n')
    .replace(/^(Hello,)$/m, '<strong>$1</strong>')
    .replace(/(Thank you for your help,)$/m, '<strong>$1</strong>')
    // Bold the issue description header
    .replace(/(Shipment \d+ has the following issues:)/g, '<strong>$1</strong>')
    // Bold the action items header
    .replace(/(Action items:)/g, '<strong>$1</strong>')

  return { subject, text, html }
}

/**
 * Get the email body text based on issue type and reshipment status
 */
function getEmailBody(data: ClaimEmailData): string {
  const templateNum = getTemplateNumber(data.issueType, data.reshipmentStatus)

  switch (templateNum) {
    case 1:
      return templateLostInTransit(data)
    case 2:
      return templateDamage(data)
    case 3:
      return templateIncorrectItemsReship(data)
    case 4:
      return templateIncorrectItemsAlreadyReshipped(data)
    case 5:
      return templateIncorrectItemsDontReship(data)
    case 6:
      return templateShortShipReship(data)
    case 7:
      return templateShortShipAlreadyReshipped(data)
    case 8:
      return templateShortShipDontReship(data)
    default:
      return templateLostInTransit(data)
  }
}

/**
 * Determine which template number to use
 */
function getTemplateNumber(issueType: IssueType, reshipmentStatus: ReshipmentStatus | null): number {
  if (issueType === 'Loss') return 1
  if (issueType === 'Damage') return 2

  if (issueType === 'Pick Error') {
    if (reshipmentStatus === 'Please reship for me') return 3
    if (reshipmentStatus === "I've already reshipped") return 4
    return 5 // "Don't reship"
  }

  if (issueType === 'Short Ship') {
    if (reshipmentStatus === 'Please reship for me') return 6
    if (reshipmentStatus === "I've already reshipped") return 7
    return 8 // "Don't reship"
  }

  return 1 // fallback
}

// =============================================================================
// Template Functions
// =============================================================================

/**
 * Template 1: Lost in Transit
 */
function templateLostInTransit(data: ClaimEmailData): string {
  return `Hello,

I am writing to you on behalf of Merchant ID ${data.merchantId}.

Shipment ${data.shipmentId} is lost in transit.

Thank you for your help,
Nora`
}

/**
 * Template 2: Damage
 */
function templateDamage(data: ClaimEmailData): string {
  return `Hello,

I am writing to you on behalf of Merchant ID ${data.merchantId}.

Shipment ${data.shipmentId} arrived damaged.

Please see attached photos and documentation.

Thank you for your help,
Nora`
}

/**
 * Template 3: Incorrect Items - "Please reship for me"
 */
function templateIncorrectItemsReship(data: ClaimEmailData): string {
  return `Hello,

I am writing to you on behalf of Merchant ID ${data.merchantId}.

Shipment ${data.shipmentId} has the following issues:
${data.description || 'No description provided'}

Please see attached photos and documentation.

Action items:
- The merchant would like you to reship for them.
- For compensation, please ${data.compensationRequest || 'credit the item cost'}

Thank you for your help,
Nora`
}

/**
 * Template 4: Incorrect Items - "I've already reshipped"
 */
function templateIncorrectItemsAlreadyReshipped(data: ClaimEmailData): string {
  return `Hello,

I am writing to you on behalf of Merchant ID ${data.merchantId}.

Shipment ${data.shipmentId} has the following issues:
${data.description || 'No description provided'}

Please see attached photos and documentation.

Action items:
- For compensation, please ${data.compensationRequest || 'credit the item cost'}
- ${data.merchantName} has created a reshipment for this order, ID ${data.reshipmentId || 'N/A'}

Thank you for your help,
Nora`
}

/**
 * Template 5: Incorrect Items - "Don't reship"
 */
function templateIncorrectItemsDontReship(data: ClaimEmailData): string {
  return `Hello,

I am writing to you on behalf of Merchant ID ${data.merchantId}.

Shipment ${data.shipmentId} has the following issues:
${data.description || 'No description provided'}

Please see attached photos and documentation.

Action items:
- For compensation, please ${data.compensationRequest || 'credit the item cost'}
- No reshipment is necessary

Thank you for your help,
Nora`
}

/**
 * Template 6: Short Ship - "Please reship for me"
 */
function templateShortShipReship(data: ClaimEmailData): string {
  return `Hello,

I am writing to you on behalf of Merchant ID ${data.merchantId}.

Shipment ${data.shipmentId} has the following issues:
${data.description || 'No description provided'}

Please see attached photos and documentation.

Action items:
- The merchant would like you to reship for them.
- Please credit the reshipment fee

Thank you for your help,
Nora`
}

/**
 * Template 7: Short Ship - "I've already reshipped"
 */
function templateShortShipAlreadyReshipped(data: ClaimEmailData): string {
  return `Hello,

I am writing to you on behalf of Merchant ID ${data.merchantId}.

Shipment ${data.shipmentId} has the following issues:
${data.description || 'No description provided'}

Please see attached photos and documentation.

Action items:
- ${data.merchantName} has created a reshipment for this order, ID ${data.reshipmentId || 'N/A'}
- Please credit the reshipment fee

Thank you for your help,
Nora`
}

/**
 * Template 8: Short Ship - "Don't reship"
 */
function templateShortShipDontReship(data: ClaimEmailData): string {
  return `Hello,

I am writing to you on behalf of Merchant ID ${data.merchantId}.

Shipment ${data.shipmentId} has the following issues:
${data.description || 'No description provided'}

Please see attached photos and documentation.

No reshipment is necessary.

Thank you for your help,
Nora`
}
