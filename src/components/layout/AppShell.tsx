'use client';

import { useState } from 'react';
import { AppShell as MantineAppShell, Burger, Group, ScrollArea, Text, Avatar, NavLink, Divider, Button, Stack, Badge, Menu, ActionIcon, Box, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { usePathname, useRouter } from 'next/navigation'; // useRouter 추가
import Link from 'next/link';
import Cookies from 'js-cookie';
import { IconHome, IconMessageCircle, IconUserCircle, IconBrandDiscord, IconLogout, IconUser, IconUserOff, IconSettings, IconBook, IconAward, IconShoppingCart, IconCreditCard, IconHistory, IconChevronRight, IconPlus, IconTicket, IconGift, IconRobot, IconBrandPatreon, IconCalendarCheck, IconTrophy } from '@tabler/icons-react';
import { AttendanceBadge } from './AttendanceBadge';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { ModelSettingModal } from '@/components/modals/ModelSettingModal'; // ModelSettingModal import
import PointPurchaseModal from '@/components/modals/PointPurchaseModal'; // PointPurchaseModal import 추가
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/firebase/config';
import { POINT_BALANCES_COLLECTION, getPointBalanceDocId } from '@/firebase/collections'; // 포인트 컬렉션
import { PointBalance } from '@/types/point'; // 포인트 타입
import { getProxiedStorageUrl } from '@/utils/storage-utils';
import { collection, query, where, onSnapshot, documentId, doc, DocumentSnapshot, FirestoreError } from 'firebase/firestore'; // doc, DocumentSnapshot, FirestoreError 추가
import { useEffect } from 'react';

// Interface for recent chat room data
interface RecentChat {
  id: string;
  name: string;
  lastMessage: string;
  lastUpdated: Date;
  image?: string;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [opened, { toggle }] = useDisclosure();
  const [settingsOpened, { open: openSettings, close: closeSettings }] = useDisclosure(false);
  const [modelSettingsOpened, { open: openModelSettings, close: closeModelSettings }] = useDisclosure(false); // ModelSettingModal 상태
  const [, setRecentChats] = useState<RecentChat[]>([]);
  const [pointModalOpen, { open: openPointModal, close: closePointModal }] = useDisclosure(false);
  const { user, logOut, uid } = useAuth();
  const pathname = usePathname();
  const router = useRouter(); // useRouter 초기화
  const [userPoints, setUserPoints] = useState<number>(0);

  // Fetch user points
  useEffect(() => {
    if (uid) {
      const pointBalanceRef = doc(db, POINT_BALANCES_COLLECTION, getPointBalanceDocId(uid));
      const unsubscribe = onSnapshot(pointBalanceRef, (docSnap: DocumentSnapshot) => { // 타입 명시
        if (docSnap.exists()) {
          const balanceData = docSnap.data() as PointBalance;
          setUserPoints(balanceData.balance);
        } else {
          setUserPoints(0); // 잔액 정보가 없으면 0으로 설정
        }
      }, (error: FirestoreError) => { // 타입 명시
        console.error("Error fetching user points:", error);
        setUserPoints(0); // 오류 발생 시 0으로 설정
      });
      return () => unsubscribe();
    }
  }, [uid]);
  
  // Subscribe to user profile document for latest photoURL (reflects immediately after profile updates)
  const [userProfilePhotoURL, setUserProfilePhotoURL] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) {
      setUserProfilePhotoURL(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const data = snap.data() as any;
        setUserProfilePhotoURL(data?.photoURL || null);
      },
      (err) => {
        console.error('Error subscribing to user profile for avatar:', err);
      }
    );
    return () => unsub();
  }, [uid]);
  
  // Cache-busting for avatar when photoURL changes
  const [photoCacheKey, setPhotoCacheKey] = useState<number>(0);
  useEffect(() => {
    setPhotoCacheKey(Date.now());
  }, [user?.photoURL, userProfilePhotoURL]);
  const basePhotoURL = userProfilePhotoURL || user?.photoURL || undefined;
  const avatarSrc = basePhotoURL
    ? (() => {
        const base = getProxiedStorageUrl(basePhotoURL);
        const sep = base.includes('?') ? '&' : '?';
        return `${base}${sep}t=${photoCacheKey}`;
      })()
    : undefined;
  
  // Navigation items
  const navItems = [
    { label: '홈', href: '/home', icon: <IconHome size={20} stroke={1.5} /> },
    { label: '랭킹', href: '/ranking', icon: <IconTrophy size={20} stroke={1.5} /> },
    { label: '채팅', href: '/chat', icon: <IconMessageCircle size={20} stroke={1.5} /> },
    // { label: '상점', href: '/goods', icon: <IconShoppingCart size={20} stroke={1.5} /> }, // 상점 링크 제거
    // { label: '코드 사용', href: '/redeem', icon: <IconTicket size={20} stroke={1.5} /> }, // Redeem 코드 메뉴 추가
    { label: '캐릭터 생성', href: '/character/create', icon: <IconUserCircle size={20} stroke={1.5} /> },
    { label: '로어북', href: '/lorebook', icon: <IconBook size={20} stroke={1.5} /> },
    { label: '고마운분들', href: '/hall-of-fame', icon: <IconAward size={20} stroke={1.5} /> },
    { label: '프로필', href: '/profile', icon: <IconUser size={20} stroke={1.5} />, id: 'profile-page-nav', rightSection: <AttendanceBadge /> },
    { label: 'API / 계정 설정', href: '/settings', icon: <IconSettings size={20} stroke={1.5} /> },
  ];

  // Fetch recent chats when uid changes (from cookie)
  useEffect(() => {
    const uidFromCookie = uid;
    if (!uidFromCookie) return;

    // Make sure the uid is available before making Firestore queries
    let unsubscribe: (() => void) | undefined;
    let chatUnsubscribe: (() => void) | undefined;
    
    try {
      const userDocRef = collection(db, 'users');
      const userDocQuery = query(
        userDocRef,
        where('uid', '==', uidFromCookie) // 쿠키 uid 사용
      );

      unsubscribe = onSnapshot(userDocQuery,
        (snapshot) => {
          if (snapshot.empty) return;

          const userData = snapshot.docs[0].data();
          const recentChatIds = userData.recentChats || [];

          if (recentChatIds.length === 0) return;
          
          // Only proceed if we have chat IDs to query
          if (recentChatIds && recentChatIds.length > 0) {
            try {
              // Fetch recent chat rooms
              const chatRoomsRef = collection(db, 'chatRooms');
              
              // We need to handle this differently to avoid the "in" + "orderBy" issue
              // First, get the documents by ID without ordering
              const chatRoomsQuery = query(
                chatRoomsRef,
                where(documentId(), 'in', recentChatIds.slice(0, 10))
              );

              chatUnsubscribe = onSnapshot(
                chatRoomsQuery,
                (chatSnapshot) => {
                  const chats = chatSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                      id: doc.id,
                      name: data.name,
                      lastMessage: data.lastMessage || '대화를 시작해보세요',
                      lastUpdated: data.lastUpdated?.toDate() || new Date(),
                      image: data.image
                    };
                  });
                  
                  // Sort manually by lastUpdated since we removed orderBy from the query
                  const sortedChats = [...chats].sort((a, b) =>
                    b.lastUpdated.getTime() - a.lastUpdated.getTime()
                  );
                  
                  setRecentChats(sortedChats);
                },
                (error) => {
                  console.error("Error fetching chat rooms:", error);
                  // Don't set recentChats to empty to avoid UI disruption
                }
              );
            } catch (error) {
              console.error("Error setting up chat room listener:", error);
            }
          }
        },
        (error) => {
          console.error("Error fetching user data:", error);
        }
      );
    } catch (error) {
      console.error("Error in chat fetch effect:", error);
    }

    return () => {
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (error) {
          console.error("Error unsubscribing from user data listener:", error);
        }
      }
      if (chatUnsubscribe) {
        try {
          chatUnsubscribe();
        } catch (error) {
          console.error("Error unsubscribing from chat rooms listener:", error);
        }
      }
    };
  }, []); // user 의존성 제거, 쿠키 변경은 감지하지 않음 (필요 시 로직 추가)

  // Handle logout
  const handleLogout = async () => {
    try {
      await logOut();
    } catch (error) {
      console.error('로그아웃 오류:', error);
    }
  };

  return (
    <MantineAppShell
      header={{ height: 60 }}
      navbar={{
        width: 280,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="md"
      // bg="#FFFFFF" // Remove hardcoded background color
    >
      <MantineAppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Group justify="space-between" style={{ flex: 1 }}>
            <Text size="xl" fw={700} c="lightBlue">신시</Text>
            {user ? (
              <Menu shadow="md" width={280} position="bottom-end">
                <Menu.Target>
                  <UnstyledButton>
                    <Group gap="xs">
                      <Avatar src={avatarSrc} alt={user.displayName || 'User Avatar'} radius="xl" size="md" />
                      {/* <IconChevronDown size={16} stroke={1.5} /> */}
                    </Group>
                  </UnstyledButton>
                </Menu.Target>

                <Menu.Dropdown>
                  <Box p="md">
                    <Group>
                      <Avatar src={avatarSrc} alt={user.displayName || 'User Avatar'} radius="xl" size="lg" />
                      <Stack gap={0}>
                        <Text fw={500} size="sm">{user.displayName || '익명 사용자'}</Text>
                        <Text size="xs" c="dimmed"> {/* 팔로워 - 캐릭터 수 (데이터 필요) */} </Text>
                      </Stack>
                    </Group>
                  </Box>

                  <Box px="md" pb="sm">
                     <Button
                        fullWidth
                        variant="light"
                        color="violet"
                        size="md"
                        leftSection={<Text c="violet" fw={700} size="lg">💎</Text>}
                        rightSection={
                          <Box component="div" onClick={openPointModal} style={{ cursor: 'pointer' }}>
                            <IconPlus size={20} stroke={2} color="var(--mantine-color-violet-filled)" /> {/* 아이콘 색상 직접 지정 */}
                          </Box>
                        }
                        styles={{
                          label: { flexGrow: 1, textAlign: 'left' },
                          section: { marginRight: 0 }
                        }}
                      >
                       <Text fw={700} size="lg" style={{ flexGrow: 1 }}>{userPoints.toLocaleString()}</Text>
                      </Button>
                  </Box>
                  <Menu.Divider />
                  <Menu.Item
                    component="a"
                    href="https://www.patreon.com/c/user?u=96506604"
                    target="_blank"
                    rel="noopener noreferrer"
                    leftSection={<IconBrandPatreon size={16} stroke={1.5} />}
                  >
                    Patreon
                  </Menu.Item>
                  <Menu.Item leftSection={<IconRobot size={16} stroke={1.5} />} onClick={openModelSettings}> {/* ModelSettingModal 열기 */}
                    모델 설정
                  </Menu.Item>
                  <Menu.Item leftSection={<IconSettings size={16} stroke={1.5} />} onClick={openSettings}>
                    계정 설정
                  </Menu.Item>
                  <Menu.Divider />
                  <Menu.Item color="red" leftSection={<IconLogout size={16} stroke={1.5} />} onClick={handleLogout}>
                    로그아웃
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            ) : (
              <Button component={Link} href="/login" variant="default">로그인</Button>
            )}
          </Group>
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar p="md">
        <MantineAppShell.Section grow component={ScrollArea}>
          {/* <Box mb="md">
            <Text fw={500} size="sm" mb="xs">최근 채팅</Text>
            {recentChats.length > 0 ? (
              recentChats.map((chat) => (
                <NavLink
                  key={chat.id}
                  component={Link}
                  href={`/chat/${chat.id}`}
                  label={chat.name}
                  description={chat.lastMessage}
                  leftSection={
                    <Avatar src={chat.image} radius="xl" size="sm" />
                  }
                  active={pathname === `/chat/${chat.id}`}
                />
              ))
            ) : (
              <Text size="sm" c="dimmed" ta="center" py="md">
                아직 참여한 채팅방이 없습니다
              </Text>
            )}
          </Box>

          <Divider my="md" /> */}

          <Stack gap="xs">
            {navItems.map((item) => (
              <NavLink
                key={item.href}
                component={Link}
                href={item.href}
                label={item.label}
                leftSection={item.icon}
                rightSection={item.rightSection}
                active={pathname === item.href}
                id={item.id}
              />
            ))}
          </Stack>
        </MantineAppShell.Section>

        <MantineAppShell.Section>
          <Divider my="md" />
          <Group justify="center" mb="xs">
            <Button
              variant="subtle"
              color="gray"
              component="a"
              href="https://discord.gg/mfxBg6pnvw"
              target="_blank"
              rel="noopener noreferrer"
              leftSection={<IconBrandDiscord size={20} />}
            >
              디스코드
            </Button>

            <Button
              variant="subtle"
              color="gray"
              component={Link}
              href="/terms"
            >
              이용약관
            </Button>

            {/* Navbar 하단 로그아웃 버튼은 UserMenu로 이동했으므로 제거 또는 유지 선택 */}
            {/* {user && (
              <Button
                variant="subtle"
                color="red"
                onClick={handleLogout}
                leftSection={<IconLogout size={20} />}
              >
                로그아웃
              </Button>
            )} */}
          </Group>
        </MantineAppShell.Section>
      </MantineAppShell.Navbar>

      <MantineAppShell.Main>
        {children}
        {/* Settings Modals */}
        <SettingsModal opened={settingsOpened} onClose={closeSettings} />
        <ModelSettingModal opened={modelSettingsOpened} onClose={closeModelSettings} />
        <PointPurchaseModal opened={pointModalOpen} onClose={closePointModal} />
      </MantineAppShell.Main>
    </MantineAppShell>
  );
}

export default AppShell;
