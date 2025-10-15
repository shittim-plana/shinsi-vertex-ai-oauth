'use client';

import React, { useState, useEffect } from 'react';
import { Stack, Title, Text, Loader, Alert } from '@mantine/core'; // Alert 추가
import Cookies from 'js-cookie'; // js-cookie import 추가
import { collection, query, where, orderBy, onSnapshot, addDoc, doc, updateDoc, deleteDoc, getDoc, getDocs, serverTimestamp, limit } from 'firebase/firestore'; // limit 추가
import { db } from '@/firebase/config'; // Firestore 인스턴스 임포트
import { useAuth } from '@/contexts/AuthContext'; // 인증 훅 임포트 (displayName, photoURL 위해 유지)
import { Comment } from '@/types/comment'; // 댓글 타입 임포트
import CommentForm from './CommentForm';
import CommentItem from './CommentItem';

interface CommentSectionProps {
  characterId: string;
}

const CommentSection: React.FC<CommentSectionProps> = ({ characterId }) => {
  const [comments, setComments] = useState<Comment[]>([]); // 댓글 상태
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, uid } = useAuth(); // 사용자 정보 가져오기

  // Firestore에서 댓글 데이터 가져오기
  useEffect(() => {
    setLoading(true);
    setError(null);

    // 최상위 댓글 쿼리 (parentId가 없는 댓글)
    const commentsQuery = query(
      collection(db, 'comments'),
      where('characterId', '==', characterId),
      where('parentId', '==', null), // 최상위 댓글만 가져옴
      orderBy('createdAt', 'desc') // 최신순 정렬
    );

    const unsubscribe = onSnapshot(commentsQuery, async (querySnapshot) => {
      // onSnapshot 콜백: 최상위 댓글과 해당 대댓글(최대 1개)을 함께 처리
      const commentsPromises = querySnapshot.docs.map(async (doc) => {
        const commentData = { id: doc.id, ...doc.data() } as Comment;

        // 각 최상위 댓글에 대한 대댓글 쿼리 (1개만 가져옴)
        const replyQuery = query(
          collection(db, 'comments'),
          where('parentId', '==', commentData.id),
          orderBy('createdAt', 'asc'),
          limit(1) // Firestore limit 함수 사용
        );
        const replySnapshot = await getDocs(replyQuery);

        if (!replySnapshot.empty) {
          const replyData = {
            id: replySnapshot.docs[0].id,
            ...replySnapshot.docs[0].data(),
            // parentUserName 제거, replyToUserName은 대댓글 저장 시 설정됨
          } as Comment;
          // replies 필드에 대댓글 배열 추가
          return { ...commentData, replies: [replyData] };
        }
        return commentData; // 대댓글 없으면 원본 댓글 반환
      });

      try {
        const commentsWithReplies = await Promise.all(commentsPromises);
        setComments(commentsWithReplies); // 대댓글 포함된 목록으로 상태 업데이트
      } catch (err) {
        console.error("Error fetching replies within snapshot:", err);
        setError('댓글 또는 답글을 불러오는 중 오류가 발생했습니다.');
        // 오류 발생 시 일단 최상위 댓글만이라도 표시할 수 있도록 fallback 고려 가능
        const fallbackComments = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Comment[];
        setComments(fallbackComments);
      } finally {
        setLoading(false); // 로딩 완료
      }

    }, (err) => {
      console.error("Error fetching comments:", err);
      setError('댓글을 불러오는 중 오류가 발생했습니다.');
      setLoading(false);
    });

    // 컴포넌트 언마운트 시 리스너 정리
    return () => unsubscribe();
  }, [characterId]);

  // 새 댓글 추가 핸들러
  const handleAddComment = async (content: string) => {
    const uidFromCookie = uid;
    if (!uidFromCookie) {
      // TODO: 로그인 필요 알림 (예: Mantine notifications)
      console.error('로그인이 필요합니다.');
      return;
    }

    try {
      await addDoc(collection(db, 'comments'), {
        characterId: characterId,
        userId: uidFromCookie, // 쿠키 uid 사용
        userName: user?.displayName || '익명', // user 객체는 displayName 등을 위해 필요할 수 있음 (Optional Chaining 사용)
        userAvatar: user?.photoURL || '', // user 객체는 photoURL 등을 위해 필요할 수 있음 (Optional Chaining 사용)
        content: content,
        createdAt: serverTimestamp(), // Firestore 서버 타임스탬프 사용
        parentId: null, // 최상위 댓글
        likesCount: 0,
        likedBy: [],
      });
      // 성공 알림 (선택 사항)
    } catch (error) {
      console.error('댓글 추가 오류:', error);
      // 오류 알림
      setError('댓글을 추가하는 중 오류가 발생했습니다.');
    }
  };

  // 대댓글 추가 핸들러 (하위 컬렉션, 인용구 대상 지정)
  const handleAddReply = async (
    topLevelParentId: string, // 최상위 댓글 ID (컬렉션 경로용)
    targetUserName: string, // 답글 대상 사용자 이름 (인용구용)
    content: string
  ) => {
    const uidFromCookie = uid;
    if (!uidFromCookie) {
      console.error('로그인이 필요합니다.');
      return; // TODO: Show notification
    }

    // parentCommentRef는 이제 최상위 댓글을 가리킴
    const topLevelCommentRef = doc(db, 'comments', topLevelParentId);
    // 부모 댓글 존재 여부 확인은 보안 규칙에서 처리하거나, 필요시 여기서 추가 가능

// parentCommentSnap 및 parentCommentData 제거
    // const parentCommentData = parentCommentSnap.data() as Comment; // 제거

    // Add reply to the subcollection 'replies' under the parent comment
    const repliesCollectionRef = collection(topLevelCommentRef, 'replies');
    try {
      await addDoc(repliesCollectionRef, {
        characterId: characterId, // Store characterId for potential queries
        userId: uidFromCookie, // 쿠키 uid 사용
        userName: user?.displayName || '익명', // Optional Chaining 사용
        userAvatar: user?.photoURL || '', // Optional Chaining 사용
        content: content,
        createdAt: serverTimestamp(),
        // parentId is implicitly the parent document ID, no need to store
        parentId: topLevelParentId, // 최상위 부모 ID 저장
        replyToUserName: targetUserName, // 답글 대상 사용자 이름 저장
        likesCount: 0,
        likedBy: [],
        // No 'replies' field for replies (Depth 1 limit)
      });
      // Success notification (optional)
    } catch (error) {
      console.error('Error adding reply:', error);
      setError('답글을 추가하는 중 오류가 발생했습니다.');
    }
  };

  // 댓글 삭제 핸들러
  // 댓글/대댓글 삭제 핸들러 (소프트 삭제 적용)
  const handleDeleteComment = async (commentId: string, isReply?: boolean, parentId?: string) => {
    const uidFromCookie = uid;
    if (!uidFromCookie) {
      console.error('로그인이 필요합니다.');
      return;
    }

    // Delete the comment and its replies subcollection
    if (isReply && parentId) {
      // --- Case 1: Deleting a Reply (Hard Delete) ---
      // --- Case 1: Deleting a Reply (Hard Delete) ---
      const parentCommentRef = doc(db, 'comments', parentId); // Get parent ref
      const replyRef = doc(parentCommentRef, 'replies', commentId); // Get reply ref using parent ref

      try {
        await deleteDoc(replyRef); // Delete the reply
        console.log('Reply deleted successfully:', commentId);

        // Check if the parent comment should now be hard deleted
        const parentSnap = await getDoc(parentCommentRef);
        if (parentSnap.exists() && parentSnap.data().isDeleted) {
          // Parent is soft-deleted, check if it has any remaining replies
          const repliesQuery = query(collection(parentCommentRef, 'replies'), limit(1));
          const repliesSnapshot = await getDocs(repliesQuery);
          if (repliesSnapshot.empty) {
            // No replies left, hard delete the soft-deleted parent comment
            await deleteDoc(parentCommentRef);
            console.log('Soft-deleted parent comment hard deleted as all replies are gone:', parentId);
          }
        }
      } catch (error) {
        console.error('Error deleting reply or checking parent:', error);
        setError('답글 삭제 또는 부모 댓글 확인 중 오류가 발생했습니다.');
      }
    } else {
      // --- Case 2: Deleting a Top-Level Comment ---
      const commentRef = doc(db, 'comments', commentId);
      const repliesCollectionRef = collection(commentRef, 'replies');

      try {
        // Check if the comment has any replies
        const repliesQuery = query(repliesCollectionRef, limit(1));
        const repliesSnapshot = await getDocs(repliesQuery);

        if (repliesSnapshot.empty) {
          // --- Subcase 2a: No replies (Hard Delete) ---
          await deleteDoc(commentRef);
          console.log('Comment deleted successfully (no replies):', commentId);
        } else {
          // --- Subcase 2b: Has replies (Soft Delete) ---
          await updateDoc(commentRef, {
            content: "삭제된 댓글입니다.",
            userName: "알 수 없음", // Or keep original name but indicate deletion
            userAvatar: "", // Clear avatar
            isDeleted: true,
            updatedAt: serverTimestamp(),
          });
          console.log('Comment soft deleted (has replies):', commentId);
          // Note: The replies subcollection remains
        }
      } catch (error) {
        console.error('Error deleting comment:', error);
        setError('댓글을 삭제하는 중 오류가 발생했습니다.');
      }
    }
  };

  // 댓글 수정 핸들러
  const handleUpdateComment = async (commentId: string, newContent: string) => {
    const uidFromCookie = uid;
    if (!uidFromCookie) {
      console.error('로그인이 필요합니다.');
      return;
    }

    const commentRef = doc(db, 'comments', commentId);
    try {
      await updateDoc(commentRef, {
        content: newContent,
        updatedAt: serverTimestamp(), // 수정 시각 업데이트
      });
      console.log('댓글 수정 완료:', commentId);
    } catch (error) {
      console.error('댓글 수정 오류:', error);
      setError('댓글을 수정하는 중 오류가 발생했습니다.');
    }
  };

  if (loading) {
    return <Loader />;
  }

  if (error) {
    // Alert 컴포넌트로 오류 메시지 표시
    return <Alert color="red" title="오류 발생">{error}</Alert>;
  }

  return (
    <Stack mt="xl" gap="lg"> {/* gap 추가 */}
      <Title order={3}>댓글 ({comments.filter(c => !c.parentId).length})</Title> {/* 최상위 댓글 수 표시 */}
      {/* 로그인 상태에 따라 댓글 폼 표시 (쿠키 uid 확인) */}
      {uid ? (
        <CommentForm onSubmit={handleAddComment} />
      ) : (
        <Text c="dimmed">댓글을 작성하려면 로그인이 필요합니다.</Text>
      )}

      {/* 댓글 목록 렌더링 */}
      {comments.length === 0 && !loading ? (
        <Text c="dimmed" mt="md">아직 댓글이 없습니다. 첫 댓글을 남겨보세요!</Text>
      ) : (
        <Stack gap="md"> {/* 댓글 간 간격 */}
          {comments
            .filter(comment => !comment.parentId) // 최상위 댓글만 렌더링
            .map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment} // CommentItem이 스스로 대댓글을 가져오도록 수정 예정
                characterId={characterId}
                onAddReply={handleAddReply} // Prop 이름 및 시그니처 변경
                onDelete={handleDeleteComment} // 삭제 핸들러 전달
                onUpdate={handleUpdateComment} // 수정 핸들러 전달
                // TODO: 좋아요 핸들러 전달
              />
           ))}
        </Stack>
      )}
    </Stack>
  );
};

export default CommentSection;