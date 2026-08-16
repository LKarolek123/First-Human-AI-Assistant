import type { RefObject } from 'react';
import type { ConversationSummary } from './ai/openaiFeedback';

type WorkspaceView = 'chat' | 'memory';

type SidePanelProps = {
  copy: Record<string, string>;
  activeWorkspaceView: WorkspaceView;
  conversations: ConversationSummary[];
  archivedConversations: ConversationSummary[];
  activeConversationId: string | null;
  isArchiveViewOpen: boolean;
  isAccountMenuOpen: boolean;
  accountMenuRef: RefObject<HTMLDivElement | null>;
  onBrandClick: () => void;
  onNewConversation: () => void;
  onOpenPlugins: () => void;
  onWorkspaceViewChange: (view: WorkspaceView) => void;
  onArchiveViewOpen: () => void;
  onArchiveViewClose: () => void;
  onConversationSelect: (conversationId: string) => void;
  onConversationContextMenu: (
    conversation: ConversationSummary,
    position: { x: number; y: number },
  ) => void;
  onAccountToggle: () => void;
};

export function SidePanel({
  copy,
  activeWorkspaceView,
  conversations,
  archivedConversations,
  activeConversationId,
  isArchiveViewOpen,
  isAccountMenuOpen,
  accountMenuRef,
  onBrandClick,
  onNewConversation,
  onOpenPlugins,
  onWorkspaceViewChange,
  onArchiveViewOpen,
  onArchiveViewClose,
  onConversationSelect,
  onConversationContextMenu,
  onAccountToggle,
}: SidePanelProps) {
  const visibleConversations = isArchiveViewOpen ? archivedConversations : conversations;
  const showConversationList = activeWorkspaceView === 'chat' || isArchiveViewOpen;

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
          onClick={() => {
            onArchiveViewClose();
            onWorkspaceViewChange('memory');
          }}
        >
          {copy.memory}
        </button>
      </div>

      {activeWorkspaceView === 'memory' && !isArchiveViewOpen && (
        <button className="sidebarAction" type="button" onClick={onArchiveViewOpen}>
          <span>{copy.archivedChats}</span>
          <small>{copy.archivedChatsHint}</small>
        </button>
      )}

      {showConversationList && (
        <>
          <div className="chatSectionHeader">
            <span>{isArchiveViewOpen ? copy.archivedChats : copy.chats}</span>
          </div>
          <div className="conversationList">
            {visibleConversations.map((conversation) => (
              <button
                className={
                  conversation.id === activeConversationId
                    ? 'conversationItem conversationItemActive'
                    : 'conversationItem'
                }
                key={conversation.id}
                type="button"
                onClick={() => onConversationSelect(conversation.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onConversationContextMenu(conversation, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
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
