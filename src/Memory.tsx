import type { FormEvent } from 'react';
import type { MemoryCategory, MemoryRecord } from './ai/openaiFeedback';

type MemoryAspect = {
  title: string;
  items: string[];
};

type MemoryCategoryOption = {
  value: MemoryCategory;
  label: string;
};

type MemoryProps = {
  copy: Record<string, string>;
  memoryAspects: MemoryAspect[];
  memoryCategories: MemoryCategoryOption[];
  memoryRecords: MemoryRecord[];
  memoryCategory: MemoryCategory;
  memoryContent: string;
  editingMemoryId: string | null;
  memoryError: string | null;
  memoryNotice: string | null;
  memoryState: 'idle' | 'saving' | 'deleting';
  onMemorySubmit: (event: FormEvent<HTMLFormElement>) => void;
  onMemoryCategoryChange: (category: MemoryCategory) => void;
  onMemoryContentChange: (content: string) => void;
  onResetMemoryForm: () => void;
  onEditMemoryRecord: (record: MemoryRecord) => void;
  onDeleteMemoryRecord: (id: string) => void;
  getMemoryCategoryLabel: (category: MemoryCategory) => string;
  getMemorySourceLabel: (record: MemoryRecord) => string;
  formatDateTime: (timestamp: number) => string;
};

export function Memory({
  copy,
  memoryAspects,
  memoryCategories,
  memoryRecords,
  memoryCategory,
  memoryContent,
  editingMemoryId,
  memoryError,
  memoryNotice,
  memoryState,
  onMemorySubmit,
  onMemoryCategoryChange,
  onMemoryContentChange,
  onResetMemoryForm,
  onEditMemoryRecord,
  onDeleteMemoryRecord,
  getMemoryCategoryLabel,
  getMemorySourceLabel,
  formatDateTime,
}: MemoryProps) {
  return (
    <section className="assistantPanel" aria-label={copy.memoryPanelLabel}>
      <div className="assistantHeader">
        <div>
          <p className="eyebrow">{copy.memory}</p>
          <h2>{copy.memoryTitle}</h2>
        </div>
        <span className="languageBadge">
          {memoryRecords.length} {memoryRecords.length === 1 ? copy.memoryEntrySingular : copy.memoryEntryPlural}
        </span>
      </div>

      <div className="memoryPanel">
        <form className="memoryEditor" onSubmit={onMemorySubmit}>
          <label className="memoryField">
            <span>{copy.category}</span>
            <select
              value={memoryCategory}
              onChange={(event) => onMemoryCategoryChange(event.target.value as MemoryCategory)}
            >
              {memoryCategories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>

          <label className="memoryField">
            <span>{copy.memoryContentLabel}</span>
            <textarea
              value={memoryContent}
              onChange={(event) => onMemoryContentChange(event.target.value)}
              placeholder={copy.memoryPlaceholder}
              rows={4}
            />
          </label>

          <div className="promptActions">
            <button className="primaryButton" type="submit" disabled={memoryState !== 'idle'}>
              {memoryState === 'saving'
                ? copy.saving
                : editingMemoryId
                  ? copy.saveChanges
                  : copy.addMemory}
            </button>
            {editingMemoryId && (
              <button className="secondaryButton" type="button" onClick={onResetMemoryForm}>
                {copy.cancelEdit}
              </button>
            )}
          </div>
        </form>

        {memoryNotice && <p className="memoryNotice">{memoryNotice}</p>}
        {memoryError && <p className="voiceError">{memoryError}</p>}

        <div className="memoryList" aria-live="polite">
          {memoryRecords.length > 0 ? (
            memoryRecords.map((record) => (
              <article className="memoryRecord" key={record.id}>
                <div>
                  <strong>{getMemoryCategoryLabel(record.category)}</strong>
                  <p>{record.content}</p>
                  <small>
                    {getMemorySourceLabel(record)} | {copy.updatedAt}: {formatDateTime(record.updated_at)}
                  </small>
                </div>
                <div className="memoryRecordActions">
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => onEditMemoryRecord(record)}
                    disabled={memoryState !== 'idle'}
                  >
                    {copy.edit}
                  </button>
                  <button
                    className="secondaryButton dangerButton"
                    type="button"
                    onClick={() => onDeleteMemoryRecord(record.id)}
                    disabled={memoryState !== 'idle'}
                  >
                    {copy.delete}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="emptyChat">
              <strong>{copy.emptyMemoryTitle}</strong>
              <p>{copy.emptyMemoryBody}</p>
            </div>
          )}
        </div>

        {memoryAspects.map((aspect) => (
          <article className="memorySection" key={aspect.title}>
            <h3>{aspect.title}</h3>
            <ul>
              {aspect.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
