# React DevTools Profiler - Finding Performance Issues

## Installation

1. **Install React DevTools Chrome Extension**:
   - Visit: https://chrome.google.com/webstore (search "React Developer Tools")
   - Or Firefox: https://addons.mozilla.org/en-US/firefox/addon/react-devtools/

2. **Verify Installation**:
   - Open Chrome DevTools (Cmd+Option+I)
   - You should see two new tabs: "⚛️ Components" and "⚛️ Profiler"

---

## Using the Profiler

### Step 1: Start Recording

1. Open your app in Chrome: `http://localhost:3000/dashboard/care`
2. Open Chrome DevTools (Cmd+Option+I)
3. Click the **⚛️ Profiler** tab
4. Click the **blue record button** (circle icon)
5. Interact with your app (change filters, expand rows, etc.)
6. Click **stop recording** (red square icon)

### Step 2: Analyze the Flame Graph

The Profiler shows you:
- **Flame Graph**: Visual representation of component render times
- **Ranked Chart**: Components sorted by render duration
- **Component Chart**: Timeline of renders for a specific component

#### What to Look For:

**🔴 Red/Orange bars** = Slow renders (bad)
- Components taking > 10ms to render
- These are your performance bottlenecks

**🟢 Green/Blue bars** = Fast renders (good)
- Components taking < 5ms to render

**🟡 Yellow bars** = Medium renders
- Worth investigating if they render frequently

### Step 3: Identify Expensive Re-renders

Click on a slow component (red/orange bar) to see:

1. **"Why did this render?"**
   - Props changed
   - State changed
   - Parent re-rendered
   - Hook changed

2. **"Rendered by"**
   - Which component triggered this render

3. **"Render duration"**
   - How long this render took

---

## Common Issues & Fixes

### Issue 1: Expensive Components Re-rendering Too Often

**Symptom**: A component shows up frequently in the flame graph with long render times.

**Fix**: Wrap with `React.memo()`:

```typescript
// Before
export function ExpensiveComponent({ data }) {
  return <div>{/* complex rendering */}</div>
}

// After
export const ExpensiveComponent = React.memo(function ExpensiveComponent({ data }) {
  return <div>{/* complex rendering */}</div>
})
```

### Issue 2: Unstable Dependencies Causing Re-renders

**Symptom**: `useEffect` or `useCallback` triggers on every render.

**Fix**: Use `useMemo` for object/array dependencies:

```typescript
// Before - Creates new object on every render
const config = { clientId, filters: statusFilter }

// After - Stable reference
const config = useMemo(() => ({
  clientId,
  filters: statusFilter,
}), [clientId, statusFilter])
```

### Issue 3: Parent Re-renders Cascading to Children

**Symptom**: Entire component tree re-renders when only one part changed.

**Fix**: Split state into smaller pieces:

```typescript
// Before - All filters in one state
const [filters, setFilters] = useState({ status: [], type: [], date: null })

// After - Separate state for each filter
const [statusFilter, setStatusFilter] = useState([])
const [typeFilter, setTypeFilter] = useState([])
const [dateFilter, setDateFilter] = useState(null)
```

### Issue 4: Expensive Calculations on Every Render

**Symptom**: Component is slow even though props haven't changed.

**Fix**: Wrap calculations with `useMemo`:

```typescript
// Before
const sortedTickets = tickets.sort((a, b) => /* expensive sort */)

// After
const sortedTickets = useMemo(() => {
  return tickets.sort((a, b) => /* expensive sort */)
}, [tickets])
```

---

## Care Page Specific Checks

### High-Priority Components to Profile:

1. **`CarePage` container** (main component)
   - Should NOT re-render when expanded row changes
   - Should NOT re-render on column drag

2. **Table body** (`tbody`)
   - Should only re-render when tickets data changes
   - NOT when filters open/close

3. **Expanded row details** (`TicketDetailsPanel`)
   - Should only render when expanded
   - Should NOT cause parent table to re-render

4. **Filter controls** (`MultiSelectFilter`, `DateRangePicker`)
   - Should be memoized
   - Should NOT cause full page re-render on change

### Red Flags to Watch For:

- ✅ **Good**: Only the filter dropdown re-renders when filter changes
- ❌ **Bad**: Entire table re-renders when filter dropdown opens

- ✅ **Good**: Only the expanded row re-renders when you add a note
- ❌ **Bad**: All visible rows re-render when you add a note

- ✅ **Good**: Only the dragged column re-renders during drag
- ❌ **Bad**: All columns re-render on every drag movement

---

## Measuring Performance Improvements

### Before & After Comparison:

1. **Record a baseline** (before optimization):
   - Open Jetpack Care
   - Click record
   - Perform actions: change filter, expand row, sort column
   - Stop recording
   - Note the "Total render duration" (shown at top)

2. **Make optimizations** (add useMemo, React.memo, etc.)

3. **Record again** with same actions

4. **Compare**:
   - Total render duration should be lower
   - Flame graph should have fewer red/orange bars
   - Ranked chart should show faster components

### Target Metrics:

| Action | Target Time | Current (Before) |
|--------|-------------|------------------|
| Change status filter | < 50ms | ? |
| Expand/collapse row | < 100ms | ? |
| Sort column | < 150ms | ? |
| Search input (debounced) | < 200ms | ? |
| Drag column | < 16ms (60fps) | ? |

---

## Advanced: Production Profiling

React DevTools only works in development. For production profiling:

1. **Enable profiling in production** (next.config.ts):

```typescript
const nextConfig = {
  reactStrictMode: true,

  // Enable React Profiler in production
  webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'react-dom$': 'react-dom/profiling',
        'scheduler/tracing': 'scheduler/tracing-profiling',
      }
    }
    return config
  },
}
```

2. **Use Performance API** for custom measurements:

```typescript
performance.mark('fetchTickets-start')
await fetchTickets()
performance.mark('fetchTickets-end')
performance.measure('fetchTickets', 'fetchTickets-start', 'fetchTickets-end')
```

3. **View in Chrome Performance tab**:
   - Chrome DevTools → Performance tab
   - Record while using app
   - Look for "User Timing" section

---

## Resources

- **React Profiler API Docs**: https://react.dev/reference/react/Profiler
- **React DevTools Tutorial**: https://react.dev/learn/react-developer-tools
- **Performance Optimization Guide**: https://react.dev/learn/render-and-commit

---

## Next Steps for Care Page

After profiling, you should:

1. **Identify the top 3 slowest components** from the Ranked Chart
2. **Check their re-render causes** (props? state? parent?)
3. **Apply appropriate optimizations** (memo, useMemo, useCallback)
4. **Re-profile to verify** improvements
5. **Repeat** until all interactions feel instant
