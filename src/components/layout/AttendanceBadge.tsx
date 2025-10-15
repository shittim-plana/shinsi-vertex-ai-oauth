import { Badge } from '@mantine/core';
import { useAuth } from '@/contexts/AuthContext';
import { useAttendance } from '@/hooks/useAttendance';

export function AttendanceBadge() {
  const { user } = useAuth();
  const { status, loading } = useAttendance();

  if (!user || loading || status.todayClaimed) {
    return null;
  }

  return (
    <Badge color="green" variant="light" style={{ cursor: 'pointer' }} onClick={() => {
        const profilePage = document.getElementById('profile-page-nav');
        if(profilePage) profilePage.click();
    }}>
      출석체크
    </Badge>
  );
}