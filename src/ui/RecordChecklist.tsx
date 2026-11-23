import { MarkdownView } from './MarkdownView';

export function RecordChecklist({source, disabled, save}: {source:string; disabled:boolean; save:(text:string)=>Promise<void>}) {
  const lines = source.split(/(\r?\n)/);
  const items = lines.flatMap((line, index) => {
    const match = /^([-*+]\s+\[)([ xX])(\]\s+)([^\n]+)$/.exec(line);
    return match ? [{index, prefix:match[1]!, checked:match[2] !== ' ', tail:match[3]! + match[4]!, label:match[4]!}] : [];
  });
  if (!items.length || items.length !== lines.filter(line => line.trim()).length)
    return <MarkdownView source={source} />;
  return <div className="record-checklist">{items.map(item => <label key={item.index}>
    <input type="checkbox" checked={item.checked} disabled={disabled} onChange={() => {
      const next = [...lines];
      next[item.index] = item.prefix + (item.checked ? ' ' : 'x') + item.tail;
      void save(next.join(''));
    }} /><span>{item.label}</span>
  </label>)}</div>;
}
