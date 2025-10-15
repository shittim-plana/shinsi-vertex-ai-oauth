'use client';

import React, { useState, useEffect } from 'react';
import { Paper, Avatar, Text, Group, Stack, Button, Box, Blockquote, Loader, Modal } from '@mantine/core'; // ActionIcon removed as Button includes icons now
import { IconEdit, IconTrash } from '@tabler/icons-react'; // IconX removed
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuth } from '@/contexts/AuthContext';
import { Comment } from '@/types/comment'; // Includes isDeleted flag
import CommentForm from './CommentForm';
import { formatDate } from '@/utils/dateUtils';

interface CommentItemProps {
  comment: Comment;
  characterId: string;
  onAddReply: (topLevelParentId: string, targetUserName: string, content: string) => Promise<void>;
  // onLike?: (commentId: string, isReply: boolean) => Promise<void>;
  onDelete: (commentId: string, isReply?: boolean, parentId?: string) => Promise<void>;
  onUpdate: (commentId: string, newContent: string, isReply?: boolean, parentId?: string) => Promise<void>;
}

const CommentItem: React.FC<CommentItemProps> = ({
  comment,
  characterId,
  onAddReply,
  // onLike,
  onDelete,
  onUpdate,
}) => {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const { user } = useAuth();
  const isOwner = user?.uid === comment.userId;
  const [replies, setReplies] = useState<Comment[]>([]);
  const [repliesLoading, setRepliesLoading] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);

  // Fetch replies from subcollection
  useEffect(() => {
    // Fetch even if the parent comment is soft-deleted
    if (comment.parentId) {
      return;
    }

    setRepliesLoading(true);
    const repliesQuery = query(
      collection(db, 'comments', comment.id, 'replies'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(repliesQuery, (querySnapshot) => {
      const fetchedReplies = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // parentUserName removed, using replyToUserName from data
      })) as Comment[];
      setReplies(fetchedReplies);
      setRepliesLoading(false);
    }, (error) => {
      console.error("Error fetching replies:", error);
      setRepliesLoading(false);
    });

    return () => unsubscribe();

  }, [comment.id, comment.parentId]); // Ensure isDeleted is not in dependencies

  const handleReplyToggle = () => {
    setShowReplyForm((prev) => !prev);
  };

  const handleReplySubmitInternal = async (content: string) => {
    const topLevelParentId = comment.parentId || comment.id;
    const targetUserName = comment.userName; // Target is the author of the current comment
    await onAddReply(topLevelParentId, targetUserName, content);
    setShowReplyForm(false);
  };

  const handleUpdateSubmit = async (newContent: string) => {
    if (!newContent.trim()) return;
    await onUpdate(comment.id, newContent, !!comment.parentId, comment.parentId || undefined);
    setIsEditing(false);
  };

  const handleDeleteConfirm = async () => {
    await onDelete(comment.id, !!comment.parentId, comment.parentId || undefined);
    setShowDeleteConfirm(false);
  };

  // Render null if trying to render a deleted reply directly (shouldn't happen with current logic)
  // Or handle based on specific UI requirements for deleted replies if needed differently
  // if (comment.isDeleted && comment.parentId) {
  //   return null; // Or a placeholder for a deleted reply
  // }

  return (
    <Paper withBorder p="md" radius="sm" mt="sm">
      <Group align="flex-start">
        <Avatar src={comment.isDeleted ? null : comment.userAvatar} alt={comment.isDeleted ? '삭제됨' : comment.userName} radius="xl" /> {/* src에 null 전달 */}
        <Stack gap="xs" style={{ flex: 1 }}>
          {/* Header - Show basic info even if deleted */}
          {!isEditing && (
            <Group justify="space-between">
              <Text fw={500} c={comment.isDeleted ? 'dimmed' : undefined}>
                {comment.isDeleted ? '알 수 없음' : comment.userName}
              </Text>
              <Group gap="xs">
                <Text size="xs" c="dimmed">{formatDate(comment.createdAt)}</Text>
                {/* Show "edited" only if not deleted */}
                {!comment.isDeleted && comment.updatedAt && <Text size="xs" c="dimmed">(수정됨)</Text>}
              </Group>
            </Group>
          )}

          {/* Content - Show deleted message or actual content */}
          {!isEditing && (
            <>
              {/* Show quote only if it's a reply and not deleted */}
              {!comment.isDeleted && comment.replyToUserName && (
                <Blockquote p="xs" fz="sm" color="gray">
                  @{comment.replyToUserName} 님에게 보내는 답글
                </Blockquote>
              )}
              <Text c={comment.isDeleted ? 'dimmed' : undefined}>
                {comment.isDeleted ? '삭제된 댓글입니다.' : comment.content}
              </Text>
            </>
          )}

          {/* Edit Form - Only shown if editing and not deleted */}
          {isEditing && !comment.isDeleted && (
            <CommentForm
              onSubmit={handleUpdateSubmit}
              initialContent={comment.content}
              buttonLabel="수정 완료"
              onCancel={() => setIsEditing(false)}
            />
          )}

          {/* Action Buttons - Hidden if editing or deleted */}
          {!isEditing && !comment.isDeleted && (
            <Group gap="xs" mt="xs">
              {/* Reply Button */}
              <Button variant="subtle" size="xs" onClick={handleReplyToggle}>
                답글 달기
              </Button>

              {/* Edit/Delete Buttons (Owner only) */}
              {isOwner && (
                <>
                  <Button variant="subtle" size="xs" leftSection={<IconEdit size={14} />} onClick={() => setIsEditing(true)}>
                    수정
                  </Button>
                  <Button variant="subtle" size="xs" color="red" leftSection={<IconTrash size={14} />} onClick={() => setShowDeleteConfirm(true)}>
                    삭제
                  </Button>
                </>
              )}
            </Group>
          )}

          {/* Reply Form - Shown when toggled, hidden if editing or deleted */}
          {!isEditing && !comment.isDeleted && showReplyForm && (
            <Box mt="sm" pl="xl">
              <CommentForm
                onSubmit={handleReplySubmitInternal}
                placeholder={`@${comment.userName} 님에게 답글 남기기...`}
                buttonLabel="답글 작성"
              />
            </Box>
          )}

          {/* Replies Section - Render replies, hidden if editing (shown even if parent is deleted) */}
          {!isEditing && !comment.parentId && ( // Only render replies section for top-level comments
            <Box mt="md" pl="xl" style={{ borderLeft: '2px solid #eee', marginLeft: '4px' }}>
              {repliesLoading && <Loader size="xs" mt="xs" />}
              {!repliesLoading && replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  characterId={characterId}
                  onAddReply={onAddReply}
                  onDelete={onDelete}
                  onUpdate={onUpdate}
                  // onLike={onLike}
                />
              ))}
            </Box>
          )}
        </Stack>

        {/* Delete Confirmation Modal */}
        <Modal opened={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title={`댓글${comment.parentId ? ' 답글' : ''} 삭제 확인`} centered size="sm">
          <Text>
            {/* Adjust confirmation message based on soft/hard delete */}
            {comment.parentId || replies.length === 0
              ? `정말로 이 ${comment.parentId ? '답글' : '댓글'}을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`
              : `이 댓글에는 답글이 있습니다. 댓글 내용을 "삭제된 댓글입니다."로 변경하시겠습니까? 답글은 유지됩니다.`}
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setShowDeleteConfirm(false)}>취소</Button>
            <Button color="red" onClick={handleDeleteConfirm}>
              {comment.parentId || replies.length === 0 ? '삭제' : '내용 변경'}
            </Button>
          </Group>
        </Modal>
      </Group>
    </Paper>
  );
};

export default CommentItem;