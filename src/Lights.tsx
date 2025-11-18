export default function Lights() {
    return(
        <>
            <directionalLight intensity={0.5} position={[-1, 2.6, 1.4]} castShadow />
            <ambientLight intensity={0.2} />
        </>
    )
}