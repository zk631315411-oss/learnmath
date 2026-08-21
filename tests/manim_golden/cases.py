"""Ten deterministic low-cost scenes spanning the supported v1 teaching scope."""

CASES = [
    ("function_shift", '''from manim import *
import numpy as np
class GeneratedScene(Scene):
    def construct(self):
        axes = Axes(x_range=[-3,3,1], y_range=[-1,5,1], x_length=6, y_length=4)
        curve = axes.plot(lambda x: x*x, x_range=[-2,2], color=BLUE)
        shifted = axes.plot(lambda x: (x-1)*(x-1), x_range=[-1,3], color=GREEN)
        self.play(Create(axes), Create(curve), run_time=1)
        self.play(Transform(curve, shifted), run_time=1)
'''),
    ("derivative_tangent", '''from manim import *
import numpy as np
class GeneratedScene(Scene):
    def construct(self):
        axes = Axes(x_range=[-3,3,1], y_range=[-1,5,1], x_length=6, y_length=4)
        graph = axes.plot(lambda x: x*x/2, x_range=[-2.5,2.5], color=BLUE)
        tangent = axes.plot(lambda x: x-0.5, x_range=[-1,3], color=YELLOW)
        dot = Dot(axes.c2p(1,0.5), color=RED)
        self.play(Create(axes), Create(graph), run_time=1)
        self.play(FadeIn(dot), Create(tangent), run_time=1)
'''),
    ("riemann_sum", '''from manim import *
import numpy as np
class GeneratedScene(Scene):
    def construct(self):
        axes = Axes(x_range=[0,4,1], y_range=[0,5,1], x_length=6, y_length=4)
        graph = axes.plot(lambda x: 0.25*x*x+0.5, x_range=[0,4], color=BLUE)
        coarse = axes.get_riemann_rectangles(graph, x_range=[0,4], dx=1, fill_opacity=0.6)
        fine = axes.get_riemann_rectangles(graph, x_range=[0,4], dx=0.25, fill_opacity=0.6)
        self.play(Create(axes), Create(graph), FadeIn(coarse), run_time=1)
        self.play(Transform(coarse, fine), run_time=1)
'''),
    ("vector_addition", '''from manim import *
import numpy as np
class GeneratedScene(Scene):
    def construct(self):
        plane = NumberPlane(x_range=[-4,4,1], y_range=[-3,3,1])
        a = Arrow(ORIGIN, np.array([2,1,0]), buff=0, color=BLUE)
        b = Arrow(np.array([2,1,0]), np.array([3,3,0]), buff=0, color=GREEN)
        total = Arrow(ORIGIN, np.array([3,3,0]), buff=0, color=YELLOW)
        self.play(Create(plane), GrowArrow(a), run_time=1)
        self.play(GrowArrow(b), GrowArrow(total), run_time=1)
'''),
    ("linear_map", '''from manim import *
import numpy as np
class GeneratedScene(Scene):
    def construct(self):
        grid = NumberPlane(x_range=[-4,4,1], y_range=[-3,3,1])
        vector = Vector([2,1], color=YELLOW)
        self.add(grid, vector)
        self.play(grid.animate.apply_matrix([[1,0.6],[0.2,1]]), vector.animate.apply_matrix([[1,0.6],[0.2,1]]), run_time=2)
'''),
    ("unit_circle", '''from manim import *
import numpy as np
class GeneratedScene(Scene):
    def construct(self):
        circle = Circle(radius=2, color=BLUE)
        radius = Line(ORIGIN, 2*RIGHT, color=YELLOW)
        dot = Dot(2*RIGHT, color=RED)
        group = VGroup(radius, dot)
        self.play(Create(circle), FadeIn(group), run_time=1)
        self.play(Rotate(group, angle=PI/2, about_point=ORIGIN), run_time=1)
'''),
    ("probability_bars", '''from manim import *
import numpy as np
class GeneratedScene(Scene):
    def construct(self):
        bars = VGroup(*[Rectangle(width=0.7, height=h, color=BLUE, fill_opacity=0.6) for h in [0.5,1.2,2.1,2.1,1.2,0.5]])
        bars.arrange(RIGHT, buff=0.12, aligned_edge=DOWN).move_to(DOWN)
        target = bars.copy()
        for bar, h in zip(target, [0.8,1.5,2.5,2.5,1.5,0.8]): bar.stretch_to_fit_height(h).align_to(DOWN, DOWN)
        self.play(LaggedStart(*[GrowFromEdge(bar, DOWN) for bar in bars], lag_ratio=0.1), run_time=1)
        self.play(Transform(bars, target), run_time=1)
'''),
    ("parabola_focus", '''from manim import *
import numpy as np
class GeneratedScene(Scene):
    def construct(self):
        axes = Axes(x_range=[-3,3,1], y_range=[-1,4,1], x_length=6, y_length=4)
        graph = axes.plot(lambda x: x*x/2, x_range=[-2.5,2.5], color=BLUE)
        focus = Dot(axes.c2p(0,0.5), color=RED)
        ray = Line(axes.c2p(-2,2), axes.c2p(0,0.5), color=YELLOW)
        reflected = Line(axes.c2p(0,0.5), axes.c2p(2,2), color=GREEN)
        self.play(Create(axes), Create(graph), FadeIn(focus), run_time=1)
        self.play(Create(ray), Create(reflected), run_time=1)
'''),
    ("projectile", '''from manim import *
import numpy as np
class GeneratedScene(Scene):
    def construct(self):
        axes = Axes(x_range=[0,6,1], y_range=[0,4,1], x_length=6, y_length=4)
        path = axes.plot(lambda x: -0.2*(x-3)*(x-3)+2.2, x_range=[0,6], color=BLUE)
        ball = Dot(axes.c2p(0,0.4), radius=0.12, color=RED)
        self.play(Create(axes), Create(path), run_time=1)
        self.play(MoveAlongPath(ball, path), run_time=2, rate_func=linear)
'''),
    ("pendulum", '''from manim import *
import numpy as np
class GeneratedScene(Scene):
    def construct(self):
        pivot = Dot(2*UP)
        rod = Line(2*UP, 2*UP+2*DOWN+LEFT, color=GREY)
        bob = Dot(rod.get_end(), radius=0.18, color=RED)
        pendulum = VGroup(rod, bob)
        self.add(pivot, pendulum)
        self.play(Rotate(pendulum, angle=PI/3, about_point=2*UP), run_time=1)
        self.play(Rotate(pendulum, angle=-2*PI/3, about_point=2*UP), run_time=2, rate_func=there_and_back)
'''),
]
