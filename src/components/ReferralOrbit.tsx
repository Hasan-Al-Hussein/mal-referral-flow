import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '../motion/MotionProvider';
import { motion, useAppTheme } from '../theme/theme';

interface ReferralOrbitProps {
  activeSteps: number;
  size?: number;
  success?: boolean;
}

const STEP_COUNT = 5;

export function ReferralOrbit({
  activeSteps,
  size = 240,
  success = false,
}: ReferralOrbitProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(reducedMotion ? activeSteps : 0));
  const [entry] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const nodeSize = Math.max(12, size * 0.066);
  const orbitRadius = size * 0.43;
  const center = size / 2;

  const nodes = useMemo(
    () =>
      Array.from({ length: STEP_COUNT }, (_, index) => {
        const angle = -90 + index * (360 / STEP_COUNT);
        const radians = (angle * Math.PI) / 180;
        return {
          angle,
          left: center + Math.cos(radians) * orbitRadius - nodeSize / 2,
          top: center + Math.sin(radians) * orbitRadius - nodeSize / 2,
        };
      }),
    [center, nodeSize, orbitRadius],
  );

  const segments = useMemo(
    () => {
      const segmentColors = [colors.brandPink, colors.brandLilac, colors.brandBlue];
      return Array.from({ length: 12 }, (_, index) => {
        const angle = index * 30;
        const radians = (angle * Math.PI) / 180;
        const radius = size * 0.27;
        const segmentWidth = size * 0.085;
        const segmentHeight = Math.max(5, size * 0.026);
        return {
          angle,
          color: segmentColors[index % segmentColors.length],
          width: segmentWidth,
          height: segmentHeight,
          left: center + Math.cos(radians) * radius - segmentWidth / 2,
          top: center + Math.sin(radians) * radius - segmentHeight / 2,
        };
      });
    },
    [center, colors.brandBlue, colors.brandLilac, colors.brandPink, size],
  );

  useEffect(() => {
    progress.stopAnimation();
    if (reducedMotion) {
      progress.setValue(activeSteps);
      entry.setValue(1);
      return;
    }
    const enterAnimation = Animated.timing(entry, {
      toValue: 1,
      duration: motion.route,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    });
    const progressAnimation = Animated.timing(progress, {
      toValue: activeSteps,
      duration: Math.min(480, Math.max(motion.feedback, activeSteps * 110)),
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    });
    Animated.parallel([enterAnimation, progressAnimation]).start();
    return () => {
      enterAnimation.stop();
      progressAnimation.stop();
    };
  }, [activeSteps, entry, progress, reducedMotion]);

  const entryScale = entry.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] });
  const haloScale = progress.interpolate({
    inputRange: [0, STEP_COUNT],
    outputRange: [0.86, success ? 1.16 : 1.02],
    extrapolate: 'clamp',
  });
  const haloOpacity = progress.interpolate({
    inputRange: [0, STEP_COUNT],
    outputRange: [0.18, success ? 0.5 : 0.28],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      accessibilityRole="image"
      accessibilityLabel={`Referral journey: ${Math.min(activeSteps, STEP_COUNT)} of ${STEP_COUNT} milestones complete`}
      style={{ width: size, height: size, opacity: entry, transform: [{ scale: entryScale }] }}
    >
      <Animated.View
        style={[
          styles.halo,
          {
            width: size * 0.66,
            height: size * 0.66,
            borderRadius: size * 0.33,
            left: size * 0.17,
            top: size * 0.17,
            backgroundColor: colors.brandLilac,
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
          },
        ]}
      />
      <View
        style={[
          styles.orbit,
          {
            left: size * 0.06,
            top: size * 0.06,
            width: size * 0.88,
            height: size * 0.88,
            borderRadius: size * 0.44,
            borderColor: colors.borderStrong,
          },
        ]}
      />

      {segments.map((segment, index) => (
        <View
          key={`segment-${segment.angle}`}
          style={[
            styles.segment,
            {
              width: segment.width,
              height: segment.height,
              borderRadius: segment.height / 2,
              left: segment.left,
              top: segment.top,
              backgroundColor: segment.color,
              opacity: 0.72 + (index % 3) * 0.1,
              transform: [{ rotate: `${segment.angle + 90}deg` }],
            },
          ]}
        />
      ))}

      <LinearGradient
        colors={[colors.brandPink, colors.brandLilac, colors.brandBlue]}
        start={{ x: 0.08, y: 0.16 }}
        end={{ x: 0.92, y: 0.86 }}
        style={[
          styles.core,
          {
            width: size * 0.34,
            height: size * 0.34,
            borderRadius: size * 0.17,
            left: size * 0.33,
            top: size * 0.33,
          },
        ]}
      >
        <View
          style={[
            styles.highlight,
            {
              width: size * 0.13,
              height: size * 0.08,
              borderRadius: size * 0.07,
              left: size * 0.055,
              top: size * 0.04,
            },
          ]}
        />
        <Feather name={success ? 'check' : 'share-2'} size={size * 0.11} color={colors.white} />
      </LinearGradient>

      {nodes.map((node, index) => {
        const completed = activeSteps > index;
        const nodeProgress = progress.interpolate({
          inputRange: [index, index + 1],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        });
        const scale = nodeProgress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });
        return (
          <Animated.View
            key={`node-${node.angle}`}
            style={[
              styles.node,
              {
                width: nodeSize,
                height: nodeSize,
                borderRadius: nodeSize / 2,
                left: node.left,
                top: node.top,
                backgroundColor: completed ? colors.accent : colors.surfaceElevated,
                borderColor: completed ? colors.white : colors.borderStrong,
                opacity: nodeProgress.interpolate({ inputRange: [0, 1], outputRange: [0.58, 1] }),
                transform: [{ scale }],
              },
            ]}
          >
            {completed ? <Feather name="check" size={nodeSize * 0.58} color={colors.white} /> : null}
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  halo: { position: 'absolute' },
  orbit: { position: 'absolute', borderWidth: 1 },
  segment: { position: 'absolute' },
  core: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#6E45D8',
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
  },
  highlight: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.48)', transform: [{ rotate: '-22deg' }] },
  node: {
    position: 'absolute',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#281A4D',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
});
