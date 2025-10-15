'use client';

import { useState } from 'react';
import { Container, Title, Button, Stack, Group, Alert, Paper } from '@mantine/core';
import { IconPlus, IconAlertCircle, IconCheck, IconX } from '@tabler/icons-react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/firebase/config';
import { addDoc, updateDoc, deleteDoc, doc, serverTimestamp, collection } from 'firebase/firestore';
import { LorebookEntry } from '@/types/lorebook';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { LorebookModal } from '@/components/lorebook/LorebookModal';
import { LorebookFilters } from '@/components/lorebook/LorebookFilters';
import { LorebookSearch } from '@/components/lorebook/LorebookSearch';
import { FilteredLorebookList } from '@/components/lorebook/FilteredLorebookList';
import { useFilteredLorebooks } from '@/hooks/useFilteredLorebooks';
import { AppShell } from '@/components/layout/AppShell';

export default function LorebookPage() {
  const { user, loading: authLoading, uid } = useAuth();
  const isPrivileged = !!(user?.isAdmin || (user as any)?.isSubadmin);
  
  // 필터링된 로어북 hook 사용
  const {
    lorebookEntries,
    loading,
    error,
    filters,
    filterCounts,
    updateFilter,
    updateSearchQuery,
    updateSort,
    resetFilters
  } = useFilteredLorebooks(uid);

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [editingEntry, setEditingEntry] = useState<LorebookEntry | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);

  // 새 로어북 추가 모달 열기
  const handleOpenAddModal = () => {
    setEditingEntry(null);
    openModal();
  };

  // 기존 로어북 수정 모달 열기
  const handleOpenEditModal = (entry: LorebookEntry) => {
    setEditingEntry(entry);
    openModal();
  };

  // 로어북 추가/수정 제출 처리
  const handleModalSubmit = async (values: { title: string; description: string; tags: string[]; isPublic: boolean }) => {
    if (!uid) {
      notifications.show({
        title: '오류',
        message: '로그인이 필요합니다.',
        color: 'red',
        icon: <IconX />,
      });
      return;
    }

    setIsSubmitting(true);
    const now = serverTimestamp();

    try {
      if (editingEntry) {
        // 수정
        const entryRef = doc(db, 'lorebooks', editingEntry.id);
        await updateDoc(entryRef, {
          ...values,
          updatedAt: now,
        });
        notifications.show({
          title: '성공',
          message: '로어북 항목이 수정되었습니다.',
          color: 'green',
          icon: <IconCheck />,
        });
      } else {
        // 추가
        await addDoc(collection(db, 'lorebooks'), {
          ...values,
          userId: uid,
          createdAt: now,
          updatedAt: now,
          summary: '',
        });
        notifications.show({
          title: '성공',
          message: '새 로어북 항목이 추가되었습니다.',
          color: 'green',
          icon: <IconCheck />,
        });
      }
      closeModal();
    } catch (err) {
      console.error("Error submitting lorebook entry:", err);
      notifications.show({
        title: '오류',
        message: `로어북 항목 ${editingEntry ? '수정' : '추가'} 중 오류가 발생했습니다.`,
        color: 'red',
        icon: <IconX />,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // 로어북 삭제 처리
  const handleDeleteLorebook = async (id: string) => {
    if (!window.confirm("정말로 이 로어북 항목을 삭제하시겠습니까?")) {
      return;
    }

    try {
      const entryRef = doc(db, 'lorebooks', id);
      await deleteDoc(entryRef);
      notifications.show({
        title: '성공',
        message: '로어북 항목이 삭제되었습니다.',
        color: 'green',
        icon: <IconCheck />,
      });
    } catch (err) {
      console.error("Error deleting lorebook entry:", err);
      notifications.show({
        title: '오류',
        message: '로어북 항목 삭제 중 오류가 발생했습니다.',
        color: 'red',
        icon: <IconX />,
      });
    }
  };

  // 로어북 설명 요약 처리
  const handleSummarize = async (id: string, description: string) => {
    setSummarizingId(id);
    setSummarizeError(null);

    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: description }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '요약 중 오류가 발생했습니다.');
      }

      const { summary } = await response.json();

      // Firestore에 요약 업데이트
      const entryRef = doc(db, 'lorebooks', id);
      await updateDoc(entryRef, {
        summary: summary,
        updatedAt: serverTimestamp(),
      });

      notifications.show({
        title: '성공',
        message: '설명이 요약되었습니다.',
        color: 'yellow',
        icon: <IconCheck />,
      });

    } catch (err: any) {
      console.error("Error summarizing lorebook entry:", err);
      setSummarizeError(err.message || '요약 API 호출 중 오류 발생');
      notifications.show({
        title: '요약 오류',
        message: err.message || '설명 요약 중 오류가 발생했습니다.',
        color: 'red',
        icon: <IconX />,
      });
    } finally {
      setSummarizingId(null);
    }
  };

  const hasActiveFilters = filters.searchQuery.trim() !== '' || filters.filter !== 'all' || 
                          filters.sortBy !== 'updatedAt' || filters.sortOrder !== 'desc';

  return (
    <AppShell>
      <Container size="md" py="lg">
        <Group justify="space-between" mb="xl">
          <Title order={2}>로어북 관리</Title>
          {user && !authLoading && (
            <Button leftSection={<IconPlus size={16} />} onClick={handleOpenAddModal}>
              새 로어북 추가
            </Button>
          )}
        </Group>

        {!authLoading && !loading && user && (
          <Stack gap="lg" mb="xl">
            {/* 필터 탭 */}
            <Paper p="md" withBorder>
              <LorebookFilters
                currentFilter={filters.filter}
                filterCounts={filterCounts}
                onFilterChange={updateFilter}
              />
            </Paper>

            {/* 검색 및 정렬 */}
            <Paper p="md" withBorder>
              <LorebookSearch
                searchQuery={filters.searchQuery}
                sortBy={filters.sortBy}
                sortOrder={filters.sortOrder}
                onSearchChange={updateSearchQuery}
                onSortChange={updateSort}
                onReset={resetFilters}
              />
            </Paper>
          </Stack>
        )}

        {!user && !authLoading ? (
          <Alert icon={<IconAlertCircle size="1rem" />} title="로그인 필요" color="blue" mb="lg">
            로어북 기능을 사용하려면 로그인이 필요합니다.
          </Alert>
        ) : (
          <>
            {summarizeError && (
              <Alert 
                icon={<IconAlertCircle size="1rem" />} 
                title="요약 오류" 
                color="red" 
                mb="lg" 
                withCloseButton 
                onClose={() => setSummarizeError(null)}
              >
                {summarizeError}
              </Alert>
            )}
            
            <FilteredLorebookList
              entries={lorebookEntries}
              loading={authLoading || loading}
              error={error}
              currentUserId={uid ?? undefined}
              canManage={isPrivileged}
              searchQuery={filters.searchQuery}
              hasFilters={hasActiveFilters}
              onEdit={handleOpenEditModal}
              onDelete={handleDeleteLorebook}
              onSummarize={handleSummarize}
              summarizingId={summarizingId}
            />
          </>
        )}

        {/* 로어북 추가/수정 모달 */}
        <LorebookModal
          opened={modalOpened}
          onClose={closeModal}
          onSubmit={handleModalSubmit}
          initialData={editingEntry}
          isLoading={isSubmitting}
        />
      </Container>
    </AppShell>
  );
}