type Props = { value: string; onChange: (value: string) => void };

export default function OrganizationTypeFilter({ value, onChange }: Props) {
  return <div className="organization-type-filter" aria-label="Filter by organization type">
    <span>Organization</span>
    <div className="scope-toggle" role="group" aria-label="Organization type">
      {[['', 'All'], ['PRIVATE', 'Private'], ['GOVERNMENT', 'Government']].map(([key, label]) => <button key={key || 'all'} type="button" className={value === key ? 'selected' : ''} aria-pressed={value === key} onClick={() => onChange(key)}>{label}</button>)}
    </div>
  </div>;
}
