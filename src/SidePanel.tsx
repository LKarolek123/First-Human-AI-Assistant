import type { RefObject } from 'react';
import type { ConversationSummary } from './ai/openaiFeedback';

type WorkspaceView = 'chat' | 'memory';

type SidePanelProps = {
  copy: Record<string, string>;
  activeWorkspaceView: WorkspaceView;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  isAccountMenuOpen: boolean;
  accountMenuRef: RefObject<HTMLDivElement | null>;
  onBrandClick: () => void;
  onNewConversation: () => void;
  onOpenPlugins: () => void;
  onWorkspaceViewChange: (view: WorkspaceView) => void;
  onConversationSelect: (conversationId: string) => void;
  onAccountToggle: () => void;
};

export function SidePanel({
  copy,
  activeWorkspaceView,
  conversations,
  activeConversationId,
  isAccountMenuOpen,
  accountMenuRef,
  onBrandClick,
  onNewConversation,
  onOpenPlugins,
  onWorkspaceViewChange,
  onConversationSelect,
  onAccountToggle,
}: SidePanelProps) {
  return (
    <aside className="conversationRail" aria-label="Rozmowy">
      <div className="railHeader railHeaderCompact">
        <button className="brandButton" type="button" onClick={onBrandClick}>
          <p className="eyebrow">Human First</p>
          <h2 id="assistant-heading">Assistant</h2>
        </button>
        <button className="iconButton" type="button" onClick={onNewConversation} title={copy.newChat}>
          +
        </button>
      </div>

      <div className="sidebarNav" aria-label="Nawigacja">
        <button className="sidebarNavButton" type="button" onClick={onOpenPlugins}>
          {copy.plugins}
        </button>
        <button
          className={
            activeWorkspaceView === 'memory'
              ? 'sidebarNavButton sidebarNavButtonActive'
              : 'sidebarNavButton'
          }
          type="button"
          onClick={() => onWorkspaceViewChange('memory')}
        >
          {copy.memory}
        </button>
      </div>

      {activeWorkspaceView === 'chat' && (
        <>
          <div className="chatSectionHeader">
            <span>{copy.chats}</span>
          </div>
          <div className="conversationList">
            {conversations.map((conversation) => (
              <button
                className={
                  conversation.id === activeConversationId
                    ? 'conversationItem conversationItemActive'
                    : 'conversationItem'
                }
                key={conversation.id}
                type="button"
                onClick={() => onConversationSelect(conversation.id)}
              >
                <span>{conversation.title}</span>
                <small>{conversation.last_message ?? 'Brak wiadomości'}</small>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="accountDock" ref={accountMenuRef}>
        <button className="accountIdentity" type="button" onClick={onAccountToggle}>
          <span className="accountAvatar" aria-hidden="true">K</span>
          <div>
            <strong>Karol</strong>
            <small>{copy.localAccount}</small>
          </div>
        </button>
        <div className="accountMenuWrap">
          {isAccountMenuOpen && (
            <div className="accountMenu" aria-label="Ustawienia konta">
              <button type="button">{copy.profile}</button>
              <button type="button">{copy.settings}</button>
              <button type="button">{copy.privacy}</button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
